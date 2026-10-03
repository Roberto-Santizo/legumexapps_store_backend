import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import Juice from "../models/Juice.model"
import JuicePresentation from "../models/JuicePresentation.model"
import JuiceMix from "../models/JuiceMix.model"
import JuiceRawMaterial from "../models/JuiceRawMaterial.model"
import JuiceSpice from "../models/JuiceSpice.model"
import JuiceSpiceMaterial from "../models/JuiceSpiceMaterial.model"
import { calculateJuiceQuoteSchema } from "../schemas/juiceQuote.schema"
import { juiceConfigService } from "./juiceConfig.service"
import { buildJuiceCostLines } from "./juiceCostLines"

// Calculate-only: no quote/catalog writes. J3 imports and later persistence/UI are separate phases.
export async function calculateJuiceQuote(juiceId: number, presentationId: number, quantity: number) {
    calculateJuiceQuoteSchema.parse({ juiceId, presentationId, quantity })
    const juice = await Juice.findOne({ where: { id: juiceId, isActive: true } })
    if (!juice) throw new NotFoundError("Juice", juiceId)
    const presentation = await JuicePresentation.findOne({ where: { id: presentationId, juiceId, isActive: true } })
    if (!presentation) throw new NotFoundError("JuicePresentation", presentationId)
    const mix = await JuiceMix.findAll({
        where: { juiceId, isActive: true }, order: [["id", "ASC"]],
        include: [{ model: JuiceRawMaterial, as: "rawMaterial", required: false }],
    })
    const spices = await JuiceSpice.findAll({
        where: { juiceId, isActive: true }, order: [["id", "ASC"]],
        include: [{ model: JuiceSpiceMaterial, as: "spiceMaterial", required: false }],
    })
    // Left joins deliberately retain invalid active recipe rows: never silently price a
    // partial recipe by filtering out an inactive/missing referenced catalog item.
    if (mix.some(row => !row.rawMaterial?.isActive) || spices.some(row => !row.spiceMaterial?.isActive)) {
        throw new AppError(422, "errors.juice_invalid_recipe")
    }
    const resolved = await juiceConfigService.resolveConstants(juice.clientId)
    const result = buildJuiceCostLines({
        rawMaterials: mix.map(row => ({ rawMaterialId: row.rawMaterialId, displayName: row.rawMaterial.displayName, percentage: row.percentage, costPerLiter: row.rawMaterial.costPerLiter })),
        spices: spices.map(row => ({ spiceMaterialId: row.spiceMaterialId, displayName: row.spiceMaterial.displayName, gramsPerLiter: row.gramsPerLiter, costPerGram: row.spiceMaterial.costPerGram })),
    }, presentation, resolved.values, juice.pricePerPound, quantity)
    return {
        juiceId, presentationId, clientId: juice.clientId, juiceName: juice.displayName,
        presentationLabel: presentation.displayLabel,
        configuration: { constants: resolved.values, sources: resolved.sources, globalRevision: resolved.globalRevision },
        ...result,
    }
}
