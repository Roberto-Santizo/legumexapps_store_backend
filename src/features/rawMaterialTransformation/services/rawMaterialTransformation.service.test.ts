jest.mock("../../../database/connection", () => ({ __esModule: true, default: { transaction: jest.fn(), query: jest.fn() } }))
jest.mock("../../rawMaterial/models/RawMaterial.model", () => ({ __esModule: true, default: { findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn(), update: jest.fn() } }))
jest.mock("../../rawMaterial/models/RawMaterialTranslation.model", () => ({ __esModule: true, default: { findOne: jest.fn(), create: jest.fn() } }))
jest.mock("../models/UnprocessedRawMaterial.model", () => ({ __esModule: true, default: { findOne: jest.fn(), findByPk: jest.fn(), create: jest.fn(), destroy: jest.fn(), findAll: jest.fn() } }))
jest.mock("../models/RawMaterialTransformation.model", () => ({ __esModule: true, default: { findByPk: jest.fn(), findAll: jest.fn(), create: jest.fn(), count: jest.fn() } }))
jest.mock("../models/RawMaterialTransformationCost.model", () => ({ __esModule: true, default: { bulkCreate: jest.fn(), destroy: jest.fn(), findAll: jest.fn() } }))
jest.mock("../../unit/services/unit.service", () => ({ __esModule: true, unitService: { findOrCreatePoundUnit: jest.fn() } }))

import { Op } from "sequelize"
import sequelize from "../../../database/connection"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import RawMaterialTranslation from "../../rawMaterial/models/RawMaterialTranslation.model"
import UnprocessedRawMaterial from "../models/UnprocessedRawMaterial.model"
import RawMaterialTransformation from "../models/RawMaterialTransformation.model"
import RawMaterialTransformationCost from "../models/RawMaterialTransformationCost.model"
import { unitService } from "../../unit/services/unit.service"
import { rawMaterialTransformationService as service } from "./rawMaterialTransformation.service"
import type { SaveRawMaterialTransformationInput } from "../schemas/rawMaterialTransformation.schema"

const m = (fn: unknown) => fn as jest.Mock
const transaction = { id: "tx" }

const input: SaveRawMaterialTransformationInput = {
    unprocessedCode: "BAN-001", unprocessedName: "BANANO", processedCode: "BAN-P-001", processedName: "BANANO PROCESADO",
    processedNameEn: "PROCESSED BANANA", ingredientType: "fruit",
    inputCostPerPound: 0.06797385620915032, freightPerPound: 0, yieldPercentage: 45,
    costs: [
        { category: "direct_labor", conceptName: "LAVADO", amount: 0.0051201704489003295, costBasis: "per_processed_pound" },
        { category: "packaging", conceptName: "BOLSA", amount: 0.1085, costBasis: "per_unit", poundsPerUnit: 20 },
    ],
}

function detailRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 5, unprocessedRawMaterialId: 3, processedRawMaterialId: 9,
        unprocessedRawMaterial: { id: 3, code: "BAN-001", displayName: "BANANO", costPerPound: "0.067973856209" },
        processedRawMaterial: { id: 9, code: "BAN-P-001", displayName: "BANANO PROCESADO", isActive: true, costPerUnit: "0.1616", ingredientType: "fruit", translations: [{ language: "en", displayName: "PROCESSED BANANA" }] },
        freightPerPound: "0", yieldPercentage: "45.0000",
        inputCostUsdPerPound: "0.067973856209", freightUsdPerPound: "0", rawMaterialCostUsd: "0.151053013798",
        directLaborCostUsd: "0.005120170449", packagingCostUsd: "0.005425", otherCostUsd: "0", processedCostUsd: "0.161598184247",
        costs: [
            { id: 2, category: "packaging", conceptName: "BOLSA", amount: "0.1085", costBasis: "per_unit", poundsPerUnit: "20.0000", costUsdPerProcessedPound: "0.005425", sortOrder: 1 },
            { id: 1, category: "direct_labor", conceptName: "LAVADO", amount: "0.0051201704489", costBasis: "per_processed_pound", poundsPerUnit: null, costUsdPerProcessedPound: "0.005120170449", sortOrder: 0 },
        ],
        createdAt: new Date("2026-10-14T00:00:00Z"), updatedAt: new Date("2026-10-14T00:00:00Z"),
        ...overrides,
    }
}

beforeEach(() => {
    jest.resetAllMocks()
    m(sequelize.transaction).mockImplementation(async (operation: (tx: unknown) => unknown) => operation(transaction))
    m(unitService.findOrCreatePoundUnit).mockResolvedValue({ id: 4 })
    m(RawMaterial.findOne).mockResolvedValue(null)
    m(RawMaterial.create).mockResolvedValue({ id: 9 })
    m(RawMaterialTranslation.findOne).mockResolvedValue(null)
    m(UnprocessedRawMaterial.findOne).mockResolvedValue(null)
    m(UnprocessedRawMaterial.create).mockResolvedValue({ id: 3 })
    m(RawMaterialTransformation.create).mockResolvedValue({ id: 5 })
    m(RawMaterialTransformation.count).mockResolvedValue(0)
    // findByPk sin transacción = lectura final del detalle.
    m(RawMaterialTransformation.findByPk).mockImplementation(async (_id: number, options?: { transaction?: unknown }) => (options?.transaction ? null : detailRow()))
})

describe("createTransformation", () => {
    test("one transaction: write lock, new source, catalog raw material with the rounded cost, transformation and its cost lines", async () => {
        const result = await service.createTransformation(input)

        expect(sequelize.transaction).toHaveBeenCalledTimes(1)
        expect(sequelize.query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock(:namespace, :key)", expect.objectContaining({ transaction }))
        expect(UnprocessedRawMaterial.create).toHaveBeenCalledWith({ code: "BAN-001", displayName: "BANANO", costPerPound: 0.06797385620915032 }, { transaction })
        expect(RawMaterial.create).toHaveBeenCalledWith(expect.objectContaining({
            code: "BAN-P-001", displayName: "BANANO PROCESADO", ingredientType: "fruit", costPerUnit: 0.1616, costUnitId: 4, urlSlug: expect.any(String),
        }), { transaction })
        expect(RawMaterialTranslation.create).toHaveBeenCalledWith({ rawMaterialId: 9, language: "en", displayName: "PROCESSED BANANA" }, { transaction })
        expect(RawMaterialTransformation.create).toHaveBeenCalledWith(expect.objectContaining({
            unprocessedRawMaterialId: 3, processedRawMaterialId: 9, yieldPercentage: 45, freightPerPound: 0,
            rawMaterialCostUsd: 0.151053013798, packagingCostUsd: 0.005425, processedCostUsd: 0.161598184247,
        }), { transaction })
        expect(RawMaterialTransformationCost.bulkCreate).toHaveBeenCalledWith([
            expect.objectContaining({ transformationId: 5, conceptName: "LAVADO", sortOrder: 0, poundsPerUnit: null }),
            expect.objectContaining({ transformationId: 5, conceptName: "BOLSA", sortOrder: 1, poundsPerUnit: 20, costUsdPerProcessedPound: 0.005425 }),
        ], { transaction })
        expect(RawMaterialTransformation.findAll).not.toHaveBeenCalled()
        // Detalle con DECIMAL convertidos a número y costos ordenados por categoría.
        expect(result.processedCostUsd).toBe(0.161598184247)
        expect(result.processedNameEn).toBe("PROCESSED BANANA")
        expect(result.costs.map(cost => cost.conceptName)).toEqual(["LAVADO", "BOLSA"])
        expect(result.costs[1].poundsPerUnit).toBe(20)
    })

    test("duplicate processed code -> 409 and nothing is created", async () => {
        m(RawMaterial.findOne).mockResolvedValue({ id: 1 })
        await expect(service.createTransformation(input)).rejects.toMatchObject({ statusCode: 409, key: "errors.raw_material_code_already_exists" })
        expect(UnprocessedRawMaterial.create).not.toHaveBeenCalled()
        expect(RawMaterial.create).not.toHaveBeenCalled()
        expect(RawMaterialTransformation.create).not.toHaveBeenCalled()
    })

    test("equal unprocessed and processed codes (any case) -> 422 before opening a transaction", async () => {
        await expect(service.createTransformation({ ...input, processedCode: "ban-001" })).rejects.toMatchObject({ statusCode: 422, key: "errors.raw_material_transformation_codes_must_differ" })
        expect(sequelize.transaction).not.toHaveBeenCalled()
    })

    test("invalid calculation input never opens a transaction", async () => {
        await expect(service.createTransformation({ ...input, costs: [{ ...input.costs[1], poundsPerUnit: null }] })).rejects.toMatchObject({ statusCode: 422 })
        expect(sequelize.transaction).not.toHaveBeenCalled()
    })

    test("an existing source with a new cost recalculates its sibling transformations and their catalog cost", async () => {
        // Como Sequelize, update() modifica la instancia: las hermanas leen el costo nuevo del origen.
        const source: Record<string, unknown> = { id: 3, costPerPound: "0.040000000000" }
        const update = jest.fn(async (values: Record<string, unknown>) => Object.assign(source, values))
        source.update = update
        m(UnprocessedRawMaterial.findOne).mockResolvedValue(source)
        const siblingUpdate = jest.fn()
        m(RawMaterialTransformation.findAll).mockResolvedValue([{
            id: 2, processedRawMaterialId: 8, freightPerPound: "0", yieldPercentage: "50",
            costs: [], update: siblingUpdate,
        }])
        await service.createTransformation(input)
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ costPerPound: 0.06797385620915032 }), { transaction })
        expect(UnprocessedRawMaterial.create).not.toHaveBeenCalled()
        // Hermana: 0.0679738... / 0.5 (el origen ya actualizado).
        expect(siblingUpdate).toHaveBeenCalledWith(expect.objectContaining({ processedCostUsd: 0.135947712418 }), { transaction })
        expect(RawMaterial.update).toHaveBeenCalledWith({ costPerUnit: 0.1359 }, { where: { id: 8 }, transaction })
    })

    test("an existing source with the same cost does not touch other transformations", async () => {
        m(UnprocessedRawMaterial.findOne).mockResolvedValue({ id: 3, costPerPound: "0.06797385620915032", update: jest.fn() })
        await service.createTransformation(input)
        expect(RawMaterialTransformation.findAll).not.toHaveBeenCalled()
        expect(RawMaterial.update).not.toHaveBeenCalled()
    })

    test("a processed raw material without English name gets no translation", async () => {
        await service.createTransformation({ ...input, processedNameEn: "" })
        expect(RawMaterialTranslation.create).not.toHaveBeenCalled()
    })
})

describe("updateTransformation", () => {
    function stored(overrides: Record<string, unknown> = {}) {
        return { id: 5, unprocessedRawMaterialId: 3, processedRawMaterialId: 9, update: jest.fn(), ...overrides }
    }

    test("404 when the transformation does not exist; nothing written", async () => {
        await expect(service.updateTransformation(5, input)).rejects.toMatchObject({ statusCode: 404 })
        expect(RawMaterialTransformationCost.destroy).not.toHaveBeenCalled()
    })

    test("updates the same catalog row (no duplicate), replaces the cost lines and excludes itself from the code check", async () => {
        const transformation = stored()
        const rawMaterialUpdate = jest.fn()
        m(RawMaterialTransformation.findByPk).mockImplementation(async (_id: number, options?: { transaction?: unknown }) => (options?.transaction ? transformation : detailRow()))
        m(RawMaterial.findByPk).mockResolvedValue({ id: 9, update: rawMaterialUpdate })
        m(UnprocessedRawMaterial.findOne).mockResolvedValue({ id: 3, costPerPound: "0.06797385620915032", update: jest.fn() })
        const translationUpdate = jest.fn()
        m(RawMaterialTranslation.findOne).mockResolvedValue({ update: translationUpdate, destroy: jest.fn() })

        await service.updateTransformation(5, { ...input, yieldPercentage: 50 })

        expect(RawMaterial.create).not.toHaveBeenCalled()
        expect(rawMaterialUpdate).toHaveBeenCalledWith(expect.objectContaining({ code: "BAN-P-001", costPerUnit: 0.1465, costUnitId: 4 }), { transaction })
        expect(translationUpdate).toHaveBeenCalledWith({ displayName: "PROCESSED BANANA" }, { transaction })
        expect(transformation.update).toHaveBeenCalledWith(expect.objectContaining({ unprocessedRawMaterialId: 3, yieldPercentage: 50 }), { transaction })
        expect(RawMaterialTransformationCost.destroy).toHaveBeenCalledWith({ where: { transformationId: 5 }, transaction })
        expect(RawMaterialTransformationCost.bulkCreate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ transformationId: 5 })]), { transaction })
        const codeCheck = m(RawMaterial.findOne).mock.calls[0][0]
        expect(codeCheck.where[Op.and][1]).toEqual({ id: { [Op.ne]: 9 } })
        expect(UnprocessedRawMaterial.destroy).not.toHaveBeenCalled()
    })

    test("moving to another source removes the previous one when it has no transformations left", async () => {
        m(RawMaterialTransformation.findByPk).mockImplementation(async (_id: number, options?: { transaction?: unknown }) => (options?.transaction ? stored({ unprocessedRawMaterialId: 2 }) : detailRow()))
        m(RawMaterial.findByPk).mockResolvedValue({ id: 9, update: jest.fn() })
        m(RawMaterialTransformation.count).mockResolvedValue(0)
        await service.updateTransformation(5, input)
        expect(UnprocessedRawMaterial.destroy).toHaveBeenCalledWith({ where: { id: 2 }, transaction })
    })

    test("clearing the English name removes the translation", async () => {
        m(RawMaterialTransformation.findByPk).mockImplementation(async (_id: number, options?: { transaction?: unknown }) => (options?.transaction ? stored() : detailRow()))
        m(RawMaterial.findByPk).mockResolvedValue({ id: 9, update: jest.fn() })
        const destroy = jest.fn()
        m(RawMaterialTranslation.findOne).mockResolvedValue({ update: jest.fn(), destroy })
        await service.updateTransformation(5, { ...input, processedNameEn: undefined })
        expect(destroy).toHaveBeenCalledWith({ transaction })
    })
})

describe("previewTransformation", () => {
    test("only calculates; never opens a transaction or writes", () => {
        const result = service.previewTransformation(input)
        expect(result.processedCostUsd).toBe(0.161598184247)
        expect(sequelize.transaction).not.toHaveBeenCalled()
        expect(RawMaterial.create).not.toHaveBeenCalled()
    })
})
