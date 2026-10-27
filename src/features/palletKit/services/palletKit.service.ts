import type { Transaction } from "sequelize"
import { AppError } from "../../../shared/errors/AppError"
import Packaging from "../../packaging/models/Packaging.model"
import { PALLET_KIT_TYPES, isPalletKitType, type PalletKitType } from "../../packaging/constants/packagingMaterialType.constant"
import PalletKitMaterial from "../models/PalletKitMaterial.model"
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
export async function loadPalletKit(transaction?: Transaction): Promise<{ type: PalletKitType; options: Packaging[] }[]> {
    const rows = await PalletKitMaterial.findAll({ include: [{ model: Packaging, as: "packaging" }], order: [["id", "ASC"]], transaction })
    const materials = rows.map(row => row.packaging).filter(usableKitMaterial)
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
    const kit = await loadPalletKit()
    return { types: kit.map(({ type, options }) => ({ type, materials: options })), complete: kit.every(part => part.options.length > 0) }
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
    const removed = await PalletKitMaterial.destroy({ where: { packagingId } })
    if (!removed) throw new AppError(404, "errors.pallet_kit_material_not_found")
    return getKit()
}

export const palletKitService = { getKit, listCandidates, addMaterial, removeMaterial }
