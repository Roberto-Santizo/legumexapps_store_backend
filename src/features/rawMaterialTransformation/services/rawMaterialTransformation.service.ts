import { Op, Transaction, WhereOptions, col, fn, where as sqlWhere } from "sequelize"
import sequelize from "../../../database/connection"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import RawMaterialTranslation from "../../rawMaterial/models/RawMaterialTranslation.model"
import { unitService } from "../../unit/services/unit.service"
import UnprocessedRawMaterial from "../models/UnprocessedRawMaterial.model"
import RawMaterialTransformation from "../models/RawMaterialTransformation.model"
import RawMaterialTransformationCost from "../models/RawMaterialTransformationCost.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { generateUniqueSlug } from "../../../shared/utils/slug.util"
import { toDecimal } from "../../../shared/utils/money.util"
import { paginate, PaginatedResult, PaginationParams } from "../../../shared/utils/pagination.util"
import { TRANSFORMATION_COST_CATEGORIES } from "../constants/rawMaterialTransformation.constant"
import type { PreviewRawMaterialTransformationInput, SaveRawMaterialTransformationInput } from "../schemas/rawMaterialTransformation.schema"
import {
    calculateTransformation,
    TransformationCalculationInput,
    TransformationCalculationResult,
    TransformationCostInput,
} from "./rawMaterialTransformationCalculation"

// Todas las escrituras del módulo se serializan con un único lock transaccional: son operaciones
// administrativas poco frecuentes y un mismo origen puede alimentar varias transformaciones, así que
// esto evita interbloqueos entre un guardado y el recálculo de sus hermanas.
const WRITE_LOCK_KEYS = { namespace: 174226, key: 2 }

const SOURCE_INCLUDE = { model: UnprocessedRawMaterial, as: "unprocessedRawMaterial" }
const PROCESSED_INCLUDE = {
    model: RawMaterial,
    as: "processedRawMaterial",
    include: [{ model: RawMaterialTranslation, as: "translations" }],
}

const num = (value: unknown): number => Number(value)
const nullableNum = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))
const categoryOrder = (category: string) => TRANSFORMATION_COST_CATEGORIES.indexOf(category as never)

function lowerEquals(column: string, value: string) {
    return sqlWhere(fn("lower", col(column)), value.toLowerCase())
}

async function acquireWriteLock(transaction: Transaction): Promise<void> {
    await sequelize.query("SELECT pg_advisory_xact_lock(:namespace, :key)", { replacements: WRITE_LOCK_KEYS, transaction })
}

function assertDistinctCodes(input: SaveRawMaterialTransformationInput): void {
    if (input.unprocessedCode.toLowerCase() === input.processedCode.toLowerCase()) {
        throw new AppError(422, "errors.raw_material_transformation_codes_must_differ")
    }
}

// Mismo criterio que el CRUD de Materias Primas (código único) pero sin distinguir mayúsculas, para
// que "ban-p" y "BAN-P" no puedan coexistir.
async function assertProcessedCodeAvailable(code: string, excludeId: number | undefined, transaction: Transaction): Promise<void> {
    const conditions: WhereOptions[] = [lowerEquals("code", code)]
    if (excludeId) conditions.push({ id: { [Op.ne]: excludeId } })
    const existing = await RawMaterial.findOne({ where: { [Op.and]: conditions }, attributes: ["id"], transaction })
    if (existing) throw new AppError(409, "errors.raw_material_code_already_exists", { code })
}

function toCalculationInput(input: PreviewRawMaterialTransformationInput): TransformationCalculationInput {
    return {
        inputCostPerPound: input.inputCostPerPound,
        freightPerPound: input.freightPerPound,
        yieldPercentage: input.yieldPercentage,
        costs: input.costs,
    }
}

function storedCalculationInput(transformation: RawMaterialTransformation, source: UnprocessedRawMaterial, costs: RawMaterialTransformationCost[]): TransformationCalculationInput {
    return {
        inputCostPerPound: source.costPerPound,
        freightPerPound: transformation.freightPerPound,
        yieldPercentage: transformation.yieldPercentage,
        costs: [...costs].sort((a, b) => a.sortOrder - b.sortOrder).map(cost => ({
            category: cost.category,
            conceptName: cost.conceptName,
            amount: cost.amount,
            costBasis: cost.costBasis,
            poundsPerUnit: cost.poundsPerUnit,
        }) as TransformationCostInput),
    }
}

function calculationColumns(calculation: TransformationCalculationResult) {
    return {
        inputCostUsdPerPound: calculation.inputCostUsdPerPound,
        freightUsdPerPound: calculation.freightUsdPerPound,
        rawMaterialCostUsd: calculation.rawMaterialCostUsd,
        directLaborCostUsd: calculation.directLaborCostUsd,
        packagingCostUsd: calculation.packagingCostUsd,
        otherCostUsd: calculation.otherCostUsd,
        processedCostUsd: calculation.processedCostUsd,
    }
}

function transformationColumns(input: SaveRawMaterialTransformationInput, calculation: TransformationCalculationResult) {
    return {
        freightPerPound: input.freightPerPound,
        yieldPercentage: input.yieldPercentage,
        ...calculationColumns(calculation),
    }
}

// El origen se identifica por su código (sin distinguir mayúsculas). Si ya existe, sus datos se
// actualizan con lo enviado; costChanged indica que hay que recalcular las transformaciones hermanas.
async function upsertSource(input: SaveRawMaterialTransformationInput, transaction: Transaction): Promise<{ source: UnprocessedRawMaterial; costChanged: boolean }> {
    const values = {
        code: input.unprocessedCode,
        displayName: input.unprocessedName,
        costPerPound: input.inputCostPerPound,
    }
    const existing = await UnprocessedRawMaterial.findOne({ where: lowerEquals("code", input.unprocessedCode), transaction })
    if (!existing) return { source: await UnprocessedRawMaterial.create(values, { transaction }), costChanged: false }
    const costChanged = !toDecimal(existing.costPerPound).equals(toDecimal(input.inputCostPerPound))
    await existing.update(values, { transaction })
    return { source: existing, costChanged }
}

async function writeCosts(transformationId: number, input: SaveRawMaterialTransformationInput, calculation: TransformationCalculationResult, transaction: Transaction): Promise<void> {
    if (!input.costs.length) return
    await RawMaterialTransformationCost.bulkCreate(input.costs.map((cost, index) => ({
        transformationId,
        category: cost.category,
        conceptName: cost.conceptName,
        amount: cost.amount,
        costBasis: cost.costBasis,
        poundsPerUnit: cost.poundsPerUnit ?? null,
        costUsdPerProcessedPound: calculation.lines[index].costUsdPerProcessedPound,
        sortOrder: index,
    })), { transaction })
}

async function syncEnglishName(rawMaterialId: number, displayNameEn: string | undefined, transaction: Transaction): Promise<void> {
    const existing = await RawMaterialTranslation.findOne({ where: { rawMaterialId, language: "en" }, transaction })
    if (!displayNameEn) {
        if (existing) await existing.destroy({ transaction })
        return
    }
    if (existing) await existing.update({ displayName: displayNameEn }, { transaction })
    else await RawMaterialTranslation.create({ rawMaterialId, language: "en", displayName: displayNameEn }, { transaction })
}

// Escribe en el catálogo oficial con las mismas reglas que el CRUD de Materias Primas: código único,
// slug generado, unidad de costo forzada a la libra y costo por libra con la escala del catálogo.
async function createProcessedRawMaterial(input: SaveRawMaterialTransformationInput, catalogCostPerPound: number, transaction: Transaction): Promise<RawMaterial> {
    const urlSlug = await generateUniqueSlug(input.processedName, async candidate => {
        return !!(await RawMaterial.findOne({ where: { urlSlug: candidate }, attributes: ["id"], transaction }))
    })
    const poundUnit = await unitService.findOrCreatePoundUnit(transaction)
    const rawMaterial = await RawMaterial.create({
        code: input.processedCode,
        displayName: input.processedName,
        ingredientType: input.ingredientType,
        costPerUnit: catalogCostPerPound,
        costUnitId: poundUnit.id,
        urlSlug,
    }, { transaction })
    await syncEnglishName(rawMaterial.id, input.processedNameEn, transaction)
    return rawMaterial
}

async function updateProcessedRawMaterial(rawMaterial: RawMaterial, input: SaveRawMaterialTransformationInput, catalogCostPerPound: number, transaction: Transaction): Promise<void> {
    const poundUnit = await unitService.findOrCreatePoundUnit(transaction)
    await rawMaterial.update({
        code: input.processedCode,
        displayName: input.processedName,
        ingredientType: input.ingredientType,
        costPerUnit: catalogCostPerPound,
        costUnitId: poundUnit.id,
    }, { transaction })
    await syncEnglishName(rawMaterial.id, input.processedNameEn, transaction)
}

// Recalcula con los datos guardados (y el costo actual del origen) y propaga el resultado al
// catálogo. Las líneas de costo se actualizan también, por si su valor guardado hubiera quedado
// desalineado.
async function applyStoredCalculation(transformation: RawMaterialTransformation, source: UnprocessedRawMaterial, transaction: Transaction): Promise<void> {
    const costs = transformation.costs ?? await RawMaterialTransformationCost.findAll({ where: { transformationId: transformation.id }, transaction })
    const ordered = [...costs].sort((a, b) => a.sortOrder - b.sortOrder)
    const calculation = calculateTransformation(storedCalculationInput(transformation, source, ordered))
    await transformation.update(calculationColumns(calculation), { transaction })
    for (const [index, cost] of ordered.entries()) {
        const value = calculation.lines[index].costUsdPerProcessedPound
        if (!toDecimal(cost.costUsdPerProcessedPound).equals(value)) await cost.update({ costUsdPerProcessedPound: value }, { transaction })
    }
    await RawMaterial.update({ costPerUnit: calculation.catalogCostPerPound }, { where: { id: transformation.processedRawMaterialId }, transaction })
}

async function recalculateSiblings(source: UnprocessedRawMaterial, excludeId: number, transaction: Transaction): Promise<number> {
    const siblings = await RawMaterialTransformation.findAll({
        where: { unprocessedRawMaterialId: source.id, id: { [Op.ne]: excludeId } },
        include: [{ model: RawMaterialTransformationCost, as: "costs" }],
        order: [["id", "ASC"]],
        transaction,
    })
    for (const sibling of siblings) await applyStoredCalculation(sibling, source, transaction)
    return siblings.length
}

async function removeSourceIfUnused(sourceId: number, transaction: Transaction): Promise<void> {
    const remaining = await RawMaterialTransformation.count({ where: { unprocessedRawMaterialId: sourceId }, transaction })
    if (remaining === 0) await UnprocessedRawMaterial.destroy({ where: { id: sourceId }, transaction })
}

function toListItem(transformation: RawMaterialTransformation) {
    const source = transformation.unprocessedRawMaterial
    const processed = transformation.processedRawMaterial
    return {
        id: transformation.id,
        unprocessedRawMaterialId: source.id,
        unprocessedCode: source.code,
        unprocessedName: source.displayName,
        inputCostPerPound: num(source.costPerPound),
        processedRawMaterialId: processed.id,
        processedCode: processed.code,
        processedName: processed.displayName,
        processedIsActive: processed.isActive,
        catalogCostPerPound: nullableNum(processed.costPerUnit),
        yieldPercentage: num(transformation.yieldPercentage),
        inputCostUsdPerPound: num(transformation.inputCostUsdPerPound),
        processedCostUsd: num(transformation.processedCostUsd),
        createdAt: transformation.createdAt,
        updatedAt: transformation.updatedAt,
    }
}

export type RawMaterialTransformationListItem = ReturnType<typeof toListItem>

async function listTransformations(pagination?: PaginationParams, search?: string): Promise<PaginatedResult<RawMaterialTransformationListItem>> {
    const pattern = search ? `%${search}%` : undefined
    const where: WhereOptions = pattern ? {
        [Op.or]: [
            { "$unprocessedRawMaterial.code$": { [Op.iLike]: pattern } },
            { "$unprocessedRawMaterial.displayName$": { [Op.iLike]: pattern } },
            { "$processedRawMaterial.code$": { [Op.iLike]: pattern } },
            { "$processedRawMaterial.displayName$": { [Op.iLike]: pattern } },
        ],
    } : {}
    const result = await paginate(RawMaterialTransformation, {
        where,
        include: [SOURCE_INCLUDE, { model: RawMaterial, as: "processedRawMaterial" }],
        order: [["updatedAt", "DESC"], ["id", "DESC"]],
    }, pagination)
    return { ...result, data: result.data.map(toListItem) }
}

async function getTransformationById(id: number) {
    const transformation = await RawMaterialTransformation.findByPk(id, {
        include: [SOURCE_INCLUDE, PROCESSED_INCLUDE, { model: RawMaterialTransformationCost, as: "costs" }],
    })
    if (!transformation) throw new NotFoundError("RawMaterialTransformation", id)
    const processed = transformation.processedRawMaterial
    const siblingCount = await RawMaterialTransformation.count({
        where: { unprocessedRawMaterialId: transformation.unprocessedRawMaterialId, id: { [Op.ne]: id } },
    })
    const costs = [...(transformation.costs ?? [])].sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category) || a.sortOrder - b.sortOrder)
    return {
        ...toListItem(transformation),
        processedNameEn: processed.translations?.find(translation => translation.language === "en")?.displayName ?? null,
        ingredientType: processed.ingredientType,
        freightPerPound: num(transformation.freightPerPound),
        freightUsdPerPound: num(transformation.freightUsdPerPound),
        rawMaterialCostUsd: num(transformation.rawMaterialCostUsd),
        directLaborCostUsd: num(transformation.directLaborCostUsd),
        packagingCostUsd: num(transformation.packagingCostUsd),
        otherCostUsd: num(transformation.otherCostUsd),
        siblingCount,
        costs: costs.map(cost => ({
            id: cost.id,
            category: cost.category,
            conceptName: cost.conceptName,
            amount: num(cost.amount),
            costBasis: cost.costBasis,
            poundsPerUnit: nullableNum(cost.poundsPerUnit),
            costUsdPerProcessedPound: num(cost.costUsdPerProcessedPound),
        })),
    }
}

export type RawMaterialTransformationDetail = Awaited<ReturnType<typeof getTransformationById>>

async function listSources() {
    const sources = await UnprocessedRawMaterial.findAll({
        include: [{ model: RawMaterialTransformation, as: "transformations", attributes: ["id"] }],
        order: [["code", "ASC"]],
    })
    return sources.map(source => ({
        id: source.id,
        code: source.code,
        displayName: source.displayName,
        costPerPound: num(source.costPerPound),
        transformationCount: source.transformations?.length ?? 0,
    }))
}

// Solo calcula: nunca escribe. El frontend la usa para la vista previa del resumen.
function previewTransformation(input: PreviewRawMaterialTransformationInput): TransformationCalculationResult {
    return calculateTransformation(toCalculationInput(input))
}

async function createTransformation(input: SaveRawMaterialTransformationInput) {
    assertDistinctCodes(input)
    const calculation = calculateTransformation(toCalculationInput(input))
    const id = await sequelize.transaction(async transaction => {
        await acquireWriteLock(transaction)
        await assertProcessedCodeAvailable(input.processedCode, undefined, transaction)
        const { source, costChanged } = await upsertSource(input, transaction)
        const rawMaterial = await createProcessedRawMaterial(input, calculation.catalogCostPerPound, transaction)
        const transformation = await RawMaterialTransformation.create({
            unprocessedRawMaterialId: source.id,
            processedRawMaterialId: rawMaterial.id,
            ...transformationColumns(input, calculation),
        }, { transaction })
        await writeCosts(transformation.id, input, calculation, transaction)
        if (costChanged) await recalculateSiblings(source, transformation.id, transaction)
        return transformation.id
    })
    return getTransformationById(id)
}

async function updateTransformation(id: number, input: SaveRawMaterialTransformationInput) {
    assertDistinctCodes(input)
    const calculation = calculateTransformation(toCalculationInput(input))
    await sequelize.transaction(async transaction => {
        await acquireWriteLock(transaction)
        const transformation = await RawMaterialTransformation.findByPk(id, { transaction })
        if (!transformation) throw new NotFoundError("RawMaterialTransformation", id)
        const rawMaterial = await RawMaterial.findByPk(transformation.processedRawMaterialId, { transaction })
        if (!rawMaterial) throw new NotFoundError("RawMaterial", transformation.processedRawMaterialId)
        await assertProcessedCodeAvailable(input.processedCode, rawMaterial.id, transaction)
        const previousSourceId = transformation.unprocessedRawMaterialId
        const { source, costChanged } = await upsertSource(input, transaction)
        await updateProcessedRawMaterial(rawMaterial, input, calculation.catalogCostPerPound, transaction)
        await transformation.update({ unprocessedRawMaterialId: source.id, ...transformationColumns(input, calculation) }, { transaction })
        await RawMaterialTransformationCost.destroy({ where: { transformationId: id }, transaction })
        await writeCosts(id, input, calculation, transaction)
        if (costChanged) await recalculateSiblings(source, id, transaction)
        if (previousSourceId !== source.id) await removeSourceIfUnused(previousSourceId, transaction)
    })
    return getTransformationById(id)
}

async function recalculateTransformation(id: number) {
    await sequelize.transaction(async transaction => {
        await acquireWriteLock(transaction)
        const transformation = await RawMaterialTransformation.findByPk(id, {
            include: [{ model: RawMaterialTransformationCost, as: "costs" }],
            transaction,
        })
        if (!transformation) throw new NotFoundError("RawMaterialTransformation", id)
        const source = await UnprocessedRawMaterial.findByPk(transformation.unprocessedRawMaterialId, { transaction })
        if (!source) throw new NotFoundError("UnprocessedRawMaterial", transformation.unprocessedRawMaterialId)
        await applyStoredCalculation(transformation, source, transaction)
    })
    return getTransformationById(id)
}

export const rawMaterialTransformationService = {
    listTransformations,
    getTransformationById,
    listSources,
    previewTransformation,
    createTransformation,
    updateTransformation,
    recalculateTransformation,
}
