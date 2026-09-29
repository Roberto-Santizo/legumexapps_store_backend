import { Op } from "sequelize"
import CustomQuotePackagingOption from "../models/CustomQuotePackagingOption.model"
import Packaging from "../../packaging/models/Packaging.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { isSameOptionGroup, resolveOptionGroupSpelling } from "../../../shared/utils/optionGroup.util"
import {
    ALLOWED_QUANTITY_BASES_BY_LEVEL,
    CUSTOM_QUOTE_PACKAGING_LEVELS,
    CustomQuotePackagingLevel,
    CustomQuoteQuantityBasis
} from "../constants/customQuoteConfig.constant"
import {
    CreateCustomQuotePackagingOptionInput,
    UpdateCustomQuotePackagingOptionInput
} from "../schemas/customQuoteConfig.schema"

export interface CustomQuotePackagingOptionDto {
    id: number
    packagingId: number
    packagingCode: string | null
    packagingName: string | null
    level: string | null
    unitCost: number | null
    quantity: number | null
    quantityBasis: CustomQuoteQuantityBasis | null
    optionGroup: string | null
    isDefault: boolean
    isActive: boolean
}

const OPTION_INCLUDE = [
    { model: Packaging, as: "packaging", attributes: ["id", "code", "displayName", "packagingRole", "unitCost"] }
]

function toDto(option: CustomQuotePackagingOption): CustomQuotePackagingOptionDto {
    const unitCost = option.packaging?.unitCost
    return {
        id: option.id,
        packagingId: option.packagingId,
        packagingCode: option.packaging?.code ?? null,
        packagingName: option.packaging?.displayName ?? null,
        level: option.packaging?.packagingRole ?? null,
        // DECIMAL -> string en pg: cast en el borde del DTO (§8).
        unitCost: unitCost === null || unitCost === undefined ? null : Number(unitCost),
        quantity: option.quantity === null || option.quantity === undefined ? null : Number(option.quantity),
        quantityBasis: option.quantityBasis ?? null,
        optionGroup: option.optionGroup,
        isDefault: option.isDefault,
        isActive: option.isActive,
    }
}

function levelOf(packaging: Packaging | undefined | null): CustomQuotePackagingLevel {
    const role = packaging?.packagingRole
    if (!CUSTOM_QUOTE_PACKAGING_LEVELS.includes(role as CustomQuotePackagingLevel)) {
        throw new AppError(422, "errors.custom_quote_packaging_unknown_level", { packagingRole: role ?? "" })
    }
    return role as CustomQuotePackagingLevel
}

async function findActivePackaging(packagingId: number): Promise<Packaging> {
    const packaging = await Packaging.findOne({ where: { id: packagingId, isActive: true } })
    if (!packaging) throw new NotFoundError("Packaging", packagingId)
    return packaging
}

// La cantidad depende del nivel (ver customQuoteConfig.constant.ts): unit = por unidad; pallet = por
// palet o por caja (obligatorio elegir); intermediate = sin cantidad. Con una sola base permitida se
// asume sola si no vino.
function resolveQuantityForLevel(
    level: CustomQuotePackagingLevel,
    quantity: number | null,
    quantityBasis: CustomQuoteQuantityBasis | null
): { quantity: number | null; quantityBasis: CustomQuoteQuantityBasis | null } {
    const allowedBases = ALLOWED_QUANTITY_BASES_BY_LEVEL[level]
    if (allowedBases.length === 0) {
        if (quantity !== null || quantityBasis !== null) {
            throw new AppError(422, "errors.custom_quote_intermediate_packaging_has_no_quantity")
        }
        return { quantity: null, quantityBasis: null }
    }

    if (quantity === null) throw new AppError(422, "errors.custom_quote_packaging_quantity_required")

    const basis = quantityBasis ?? (allowedBases.length === 1 ? allowedBases[0] : null)
    if (basis === null) throw new AppError(422, "errors.custom_quote_packaging_quantity_basis_required")
    if (!allowedBases.includes(basis)) {
        throw new AppError(422, "errors.custom_quote_packaging_invalid_quantity_basis", { quantityBasis: basis })
    }
    return { quantity, quantityBasis: basis }
}

// ---- Grupos de opciones: mismo criterio que productVariantPalletMaterial.service.ts (defaults,
// auto-democión, bloqueo del default y grafía del nombre, todo POR GRUPO), con una diferencia: el
// alcance no es un SKU sino un NIVEL de toda la lista (el nivel es el packagingRole de cada fila). ----

async function findActiveGroupedRows(level: CustomQuotePackagingLevel, excludeId: number | null): Promise<CustomQuotePackagingOption[]> {
    const rows = await CustomQuotePackagingOption.findAll({
        where: { optionGroup: { [Op.ne]: null }, isActive: true },
        include: [{ model: Packaging, as: "packaging", attributes: ["id", "packagingRole"] }]
    })
    return rows.filter(row => row.id !== excludeId && row.packaging?.packagingRole === level)
}

async function resolveOptionGroupOnWrite(
    level: CustomQuotePackagingLevel,
    requestedGroup: string | null,
    excludeId: number | null
): Promise<string | null> {
    if (requestedGroup === null) return null
    const groupedRows = await findActiveGroupedRows(level, excludeId)
    return resolveOptionGroupSpelling(requestedGroup, groupedRows.map(row => row.optionGroup))
}

async function resolveIsDefaultOnWrite(
    level: CustomQuotePackagingLevel,
    optionGroup: string | null,
    requestedIsDefault: boolean,
    excludeId: number | null
): Promise<boolean> {
    if (optionGroup === null) return false

    const groupSiblings = (await findActiveGroupedRows(level, excludeId))
        .filter(row => isSameOptionGroup(row.optionGroup, optionGroup))

    if (groupSiblings.length === 0) return true

    if (requestedIsDefault) {
        const currentDefaults = groupSiblings.filter(sibling => sibling.isDefault)
        if (currentDefaults.length > 0) {
            await CustomQuotePackagingOption.update(
                { isDefault: false },
                { where: { id: { [Op.in]: currentDefaults.map(sibling => sibling.id) } } }
            )
        }
    }
    return requestedIsDefault
}

async function countOtherGroupSiblings(option: CustomQuotePackagingOption, level: CustomQuotePackagingLevel): Promise<number> {
    const groupedRows = await findActiveGroupedRows(level, option.id)
    return groupedRows.filter(row => isSameOptionGroup(row.optionGroup, option.optionGroup)).length
}

const DEACTIVATION_BLOCKED_KEYS: Record<CustomQuotePackagingLevel, string> = {
    unit: "errors.unit_material_default_deletion_blocked",
    intermediate: "errors.intermediate_material_default_deletion_blocked",
    pallet: "errors.pallet_material_default_deletion_blocked",
}

// Desactivar el default de un grupo que todavía tiene otras alternativas activas se BLOQUEA (nunca
// se auto-promueve otro), igual que eliminarlo en los materiales de un SKU.
async function assertDeactivationNotBlockedByDefault(option: CustomQuotePackagingOption, level: CustomQuotePackagingLevel): Promise<void> {
    if (option.optionGroup === null || !option.isDefault) return

    if ((await countOtherGroupSiblings(option, level)) > 0) {
        throw new AppError(409, DEACTIVATION_BLOCKED_KEYS[level], { group: option.optionGroup })
    }
}

// Vía UPDATE del mismo bloqueo: quitarle el default, volverla fija o moverla a otro grupo deja a su
// grupo viejo sin default mientras tenga otras filas.
async function assertUpdateKeepsADefault(
    option: CustomQuotePackagingOption,
    level: CustomQuotePackagingLevel,
    willBeGroup: string | null,
    willBeDefault: boolean
): Promise<void> {
    const isCurrentDefault = option.optionGroup !== null && option.isDefault
    if (!isCurrentDefault) return

    const staysDefaultOfSameGroup = willBeDefault && isSameOptionGroup(willBeGroup, option.optionGroup)
    if (staysDefaultOfSameGroup) return

    if ((await countOtherGroupSiblings(option, level)) > 0) {
        throw new AppError(409, "errors.material_default_required", { group: option.optionGroup })
    }
}

// ---- CRUD ----

async function listPackagingOptions(level?: CustomQuotePackagingLevel): Promise<CustomQuotePackagingOptionDto[]> {
    const options = await CustomQuotePackagingOption.findAll({
        include: OPTION_INCLUDE,
        order: [["isActive", "DESC"], ["id", "ASC"]],
    })
    return options
        .filter(option => !level || option.packaging?.packagingRole === level)
        .map(toDto)
}

async function findActiveOption(id: number): Promise<CustomQuotePackagingOption> {
    const option = await CustomQuotePackagingOption.findOne({ where: { id, isActive: true }, include: OPTION_INCLUDE })
    if (!option) throw new NotFoundError("CustomQuotePackagingOption", id)
    return option
}

async function getPackagingOptionById(id: number): Promise<CustomQuotePackagingOptionDto> {
    return toDto(await findActiveOption(id))
}

async function createPackagingOption(input: CreateCustomQuotePackagingOptionInput): Promise<CustomQuotePackagingOption> {
    const packaging = await findActivePackaging(input.packagingId)
    const level = levelOf(packaging)
    const quantities = resolveQuantityForLevel(level, input.quantity, input.quantityBasis)

    const existing = await CustomQuotePackagingOption.findOne({ where: { packagingId: input.packagingId } })
    if (existing) throw new AppError(409, "errors.custom_quote_option_already_exists")

    const optionGroup = await resolveOptionGroupOnWrite(level, input.optionGroup, null)
    const isDefault = await resolveIsDefaultOnWrite(level, optionGroup, input.isDefault, null)
    return CustomQuotePackagingOption.create({ packagingId: input.packagingId, ...quantities, optionGroup, isDefault })
}

async function updatePackagingOption(id: number, input: UpdateCustomQuotePackagingOptionInput): Promise<CustomQuotePackagingOption> {
    const option = await findActiveOption(id)
    const level = levelOf(option.packaging)
    const quantities = resolveQuantityForLevel(level, input.quantity, input.quantityBasis)

    const optionGroup = await resolveOptionGroupOnWrite(level, input.optionGroup, option.id)
    await assertUpdateKeepsADefault(option, level, optionGroup, input.isDefault)
    const isDefault = await resolveIsDefaultOnWrite(level, optionGroup, input.isDefault, option.id)
    return option.update({ ...quantities, optionGroup, isDefault })
}

// Desactivar: bloqueado si es el default de un grupo con otras filas activas. Reactivar: el empaque
// debe seguir activo; vuelve como default solo si su grupo quedó vacío (nunca le quita el default a
// la fila que lo tomó mientras estaba inactiva). El nombre del grupo se re-resuelve por si otra fila
// lo escribió distinto entretanto.
async function setPackagingOptionStatus(id: number, isActive: boolean): Promise<CustomQuotePackagingOption> {
    const option = await CustomQuotePackagingOption.findOne({ where: { id }, include: OPTION_INCLUDE })
    if (!option) throw new NotFoundError("CustomQuotePackagingOption", id)
    if (option.isActive === isActive) return option

    const level = levelOf(option.packaging)
    if (!isActive) {
        await assertDeactivationNotBlockedByDefault(option, level)
        return option.update({ isActive: false })
    }

    await findActivePackaging(option.packagingId)
    const optionGroup = await resolveOptionGroupOnWrite(level, option.optionGroup, option.id)
    const isDefault = await resolveIsDefaultOnWrite(level, optionGroup, false, option.id)
    return option.update({ isActive: true, optionGroup, isDefault })
}

export const customQuotePackagingOptionService = {
    listPackagingOptions,
    getPackagingOptionById,
    createPackagingOption,
    updatePackagingOption,
    setPackagingOptionStatus,
}
