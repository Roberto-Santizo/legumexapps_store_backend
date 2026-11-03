import type { Transaction } from "sequelize"
import { AppError } from "../../../shared/errors/AppError"
import Packaging from "../../packaging/models/Packaging.model"
import { PALLET_KIT_TYPES, isPalletKitType, type PalletKitType } from "../../packaging/constants/packagingMaterialType.constant"
import PalletKitMaterial from "../models/PalletKitMaterial.model"
import Client from "../../client/models/Client.model"
import { buildPalletMaterialLine } from "../../pricing/services/quoteCostLines"
import { toDecimal } from "../../../shared/utils/money.util"
import { packagingNames } from "../../../shared/utils/packagingName.util"

// Kit materials are generic, active pallet materials of a kit type with a usable cost and catalog consumption.
function usableKitMaterial(material: Packaging | undefined | null): material is Packaging {
    return !!material && material.isActive && material.classification === "generic" && material.packagingRole === "pallet" && isPalletKitType(material.materialType)
        && material.unitCost != null && Number.isFinite(Number(material.unitCost)) && Number(material.unitCost) >= 0
        && material.defaultQuantityBasis === "per_pallet" && Number(material.defaultQuantityValue) > 0
}

// The kit by type (TARIMA, ESQUINERO, STRETCH). A type may have several materials (e.g. wooden or cardboard
// corner boards): with one it is included automatically, with several the representative chooses which one.
export async function loadPalletKit(transaction?: Transaction, clientId?: number | null): Promise<{ type: PalletKitType; options: Packaging[] }[]> {
    const rows = await PalletKitMaterial.findAll({ include: [{ model: Packaging, as: "packaging" }], order: [["id", "ASC"]], transaction })
    return kitForClient(rows, clientId)
}

export function kitForClient(rows: Pick<PalletKitMaterial, "packaging" | "palletClientIds">[], clientId?: number | null) {
    const configured = rows.some(row => row.packaging?.materialType === "TARIMA" && row.palletClientIds?.length === 0)
    const exception = clientId == null ? undefined : rows.find(row => row.packaging?.materialType === "TARIMA" && row.palletClientIds?.includes(clientId))
    const selected = exception ?? rows.find(row => row.packaging?.materialType === "TARIMA" && row.palletClientIds?.length === 0)
    const materials = rows.filter(row => row.packaging?.materialType !== "TARIMA" || !configured || row === selected).map(row => row.packaging).filter(usableKitMaterial)
    return PALLET_KIT_TYPES.map(type => ({ type, options: materials.filter(material => material.materialType === type) }))
}

export type PalletKitSelection = { type: PalletKitType; packagingId: number }

// One material per kit type for a quote: the only one, or the representative's choice when there are several.
// The quantity is never chosen: it is the type's catalog consumption.
export function resolvePalletKit(kit: { type: PalletKitType; options: Packaging[] }[], selections: PalletKitSelection[] = []) {
    if (kit.some(part => !part.options.length)) throw new AppError(422, "errors.pallet_kit_missing")
    if (new Set(selections.map(choice => choice.type)).size !== selections.length) throw new AppError(422, "errors.pallet_kit_selection")
    return kit.map(({ type, options }) => {
        const choice = selections.find(row => row.type === type)
        const material = choice ? options.find(option => option.id === choice.packagingId) : options.length === 1 ? options[0] : undefined
        if (choice && !material) throw new AppError(422, "errors.pallet_kit_selection")
        if (!material) throw new AppError(422, "errors.pallet_kit_choice")
        return { type, material, chosen: options.length > 1 }
    })
}

export const palletKitLabel = (language: "es" | "en") => language === "en" ? "Pallet kit" : "Kit de paletizado"

// Cost lines of the chosen kit materials: quantity per pallet from the type, times the pallets requested.
export function palletKitLines(kit: { type: PalletKitType; options: Packaging[] }[], selections: PalletKitSelection[] | undefined, requestedPallets: number, language: "es" | "en") {
    return resolvePalletKit(kit, selections).map(({ material, chosen }) => ({ material, chosen,
        line: buildPalletMaterialLine(material.id!, material, palletKitLabel(language), toDecimal(material.defaultQuantityValue).toString(), requestedPallets) }))
}

// What the representative sees: a type with one material is included, with several they choose one.
const KIT_TYPE_LABELS: Record<PalletKitType, Record<"es" | "en", string>> = { TARIMA: { es: "Tarima", en: "Pallet" }, ESQUINERO: { es: "Esquinero", en: "Corner boards" }, STRETCH: { es: "Stretch", en: "Stretch film" } }
export function palletKitOptions(kit: { type: PalletKitType; options: Packaging[] }[], language: "es" | "en") {
    return kit.map(({ type, options }) => ({ type, group: KIT_TYPE_LABELS[type][language],
        options: options.map(option => ({ id: option.id!, packagingId: option.id!, ...packagingNames(option), isDefault: false })) }))
}

async function getKit() {
    const rows = await PalletKitMaterial.findAll({ include: [{ model: Packaging, as: "packaging" }], order: [["id", "ASC"]] })
    const kit = PALLET_KIT_TYPES.map(type => ({ type, materials: rows.map(row => row.packaging).filter(usableKitMaterial).filter(material => material.materialType === type) }))
    return { types: kit, complete: kit.every(part => part.materials.length > 0),
        palletRules: { defaultPackagingId: rows.find(row => row.palletClientIds?.length === 0)?.packaging.id ?? null,
            overrides: rows.flatMap(row => (row.palletClientIds ?? []).map(clientId => ({ clientId, packagingId: row.packaging.id }))) } }
}

async function ruleClients() {
    return Client.findAll({ attributes: ["id", "name"], where: { isActive: true }, order: [["name", "ASC"]] })
}

async function setPalletRules(input: { defaultPackagingId: number; overrides: { clientId: number; packagingId: number }[] }) {
    await PalletKitMaterial.sequelize!.transaction(async transaction => {
        await PalletKitMaterial.sequelize!.query("SELECT pg_advisory_xact_lock(174227, 2)", { transaction })
        const rows = await PalletKitMaterial.findAll({ include: [{ model: Packaging, as: "packaging" }], transaction })
        const ids = [input.defaultPackagingId, ...input.overrides.map(row => row.packagingId)]
        if (ids.some(id => !rows.some(row => row.packagingId === id && usableKitMaterial(row.packaging) && row.packaging.materialType === "TARIMA"))) throw new AppError(422, "errors.pallet_kit_material_invalid")
        const clients = await Client.findAll({ attributes: ["id"], where: { id: input.overrides.map(row => row.clientId), isActive: true }, transaction })
        if (clients.length !== input.overrides.length) throw new AppError(422, "errors.pallet_kit_client_invalid")
        for (const row of rows.filter(row => row.packaging.materialType === "TARIMA")) {
            const exceptions = input.overrides.filter(choice => choice.packagingId === row.packagingId).map(choice => choice.clientId)
            await row.update({ palletClientIds: row.packagingId === input.defaultPackagingId ? [] : exceptions.length ? exceptions : null }, { transaction })
        }
    })
    return getKit()
}

// Generic pallet materials of a kit type that are not in the kit yet.
async function listCandidates() {
    const [inKit, materials] = await Promise.all([
        PalletKitMaterial.findAll({ attributes: ["packagingId"] }),
        Packaging.findAll({ where: { isActive: true, classification: "generic", packagingRole: "pallet", materialType: [...PALLET_KIT_TYPES] }, order: [["displayName", "ASC"]] }),
    ])
    const taken = new Set(inKit.map(row => row.packagingId))
    return materials.filter(material => !taken.has(material.id!) && usableKitMaterial(material))
}

async function addMaterial(packagingId: number) {
    const material = await Packaging.findByPk(packagingId)
    if (!usableKitMaterial(material)) throw new AppError(422, "errors.pallet_kit_material_invalid")
    if (await PalletKitMaterial.findOne({ where: { packagingId } })) throw new AppError(409, "errors.pallet_kit_material_duplicate")
    await PalletKitMaterial.create({ packagingId })
    return getKit()
}

async function removeMaterial(packagingId: number) {
    await PalletKitMaterial.sequelize!.transaction(async transaction => {
        await PalletKitMaterial.sequelize!.query("SELECT pg_advisory_xact_lock(174227, 2)", { transaction })
        const assigned = await PalletKitMaterial.findOne({ where: { packagingId }, transaction })
        if (assigned?.palletClientIds != null) throw new AppError(409, "errors.pallet_kit_pallet_assigned")
        const removed = await PalletKitMaterial.destroy({ where: { packagingId }, transaction })
        if (!removed) throw new AppError(404, "errors.pallet_kit_material_not_found")
    })
    return getKit()
}

export const palletKitService = { getKit, listCandidates, addMaterial, removeMaterial, ruleClients, setPalletRules }
