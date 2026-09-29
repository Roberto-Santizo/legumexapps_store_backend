import "reflect-metadata"

// Mock a nivel de modelo, igual que el resto del repo: sin base de datos real.
jest.mock("../models/QuoteDraft.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), create: jest.fn(), update: jest.fn(), findAll: jest.fn() }
}))
// Quote se mockea SOLO para poder afirmar que el servicio de borradores jamás lo toca.
jest.mock("../../quote/models/Quote.model", () => ({
    __esModule: true,
    default: { create: jest.fn(), update: jest.fn(), findAll: jest.fn() }
}))

import { Op, UniqueConstraintError } from "sequelize"
import QuoteDraft from "../models/QuoteDraft.model"
import Quote from "../../quote/models/Quote.model"
import { quoteDraftService, DraftCalculation } from "./quoteDraft.service"
import { DRAFT_ABANDONED_AFTER_HOURS } from "../constants/quoteDraft.constant"

const mockFindOne = QuoteDraft.findOne as unknown as jest.Mock
const mockCreate = QuoteDraft.create as unknown as jest.Mock
const mockUpdate = QuoteDraft.update as unknown as jest.Mock
const mockFindAll = QuoteDraft.findAll as unknown as jest.Mock

const DRAFT_KEY = "3f1c2b8e-9d4a-4c6b-8e2f-1a2b3c4d5e6f"
const input = { productVariantId: 10, requestedPallets: 2, selectedPalletMaterialIds: [601] }
const calculation: DraftCalculation & { transportCost: number } = {
    productVariantId: 10,
    productDisplayName: "Piña IQF",
    variantLabel: "Bolsa 500 g",
    requestedPallets: 2,
    totalCost: 284.5,
    transportCost: 0,
    breakdown: { palletMaterials: [{ displayName: "CAJA", optionGroup: "Caja" }] },
}

beforeEach(() => {
    for (const mock of [mockFindOne, mockCreate, mockUpdate, mockFindAll]) mock.mockReset()
})

function stubExistingDraft(overrides: Record<string, unknown> = {}) {
    const draft = { id: 1, status: "in_progress", previewCount: 3, update: jest.fn().mockResolvedValue(undefined), ...overrides }
    return draft
}

function expectQuoteUntouched() {
    expect(Quote.create).not.toHaveBeenCalled()
    expect(Quote.update).not.toHaveBeenCalled()
}

describe("quoteDraftService.upsertFromCalculation", () => {
    it("inserta el borrador la primera vez, con previewCount 1 y status in_progress", async () => {
        mockFindOne.mockResolvedValue(null)

        await quoteDraftService.upsertFromCalculation(42, DRAFT_KEY, input, calculation)

        expect(mockFindOne).toHaveBeenCalledWith({ where: { salespersonId: 42, draftKey: DRAFT_KEY } })
        expect(mockCreate).toHaveBeenCalledWith({
            salespersonId: 42,
            draftKey: DRAFT_KEY,
            productVariantId: 10,
            productDisplayName: "Piña IQF",
            variantLabel: "Bolsa 500 g",
            requestedPallets: 2,
            totalCost: 284.5,
            input,
            breakdown: calculation.breakdown,
            previewCount: 1,
            status: "in_progress",
        })
        expectQuoteUntouched()
    })

    it("actualiza la MISMA fila con el último cálculo e incrementa previewCount", async () => {
        const existing = stubExistingDraft({ previewCount: 3 })
        mockFindOne.mockResolvedValue(existing)
        const recalculated = { ...calculation, requestedPallets: 5, totalCost: 700 }

        await quoteDraftService.upsertFromCalculation(42, DRAFT_KEY, { ...input, requestedPallets: 5 }, recalculated)

        expect(mockCreate).not.toHaveBeenCalled()
        expect(existing.update).toHaveBeenCalledWith(expect.objectContaining({
            requestedPallets: 5,
            totalCost: 700,
            input: { ...input, requestedPallets: 5 },
            previewCount: 4,
        }))
        expectQuoteUntouched()
    })

    it("siempre acota la búsqueda por el salespersonId recibido (la misma clave de otro representante es otra fila)", async () => {
        mockFindOne.mockResolvedValue(null)

        await quoteDraftService.upsertFromCalculation(7, DRAFT_KEY, input, calculation)

        expect(mockFindOne).toHaveBeenCalledWith({ where: { salespersonId: 7, draftKey: DRAFT_KEY } })
        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ salespersonId: 7, draftKey: DRAFT_KEY }))
    })

    it("no reabre ni actualiza un borrador ya convertido (preview tardío después de guardar)", async () => {
        const converted = stubExistingDraft({ status: "converted" })
        mockFindOne.mockResolvedValue(converted)

        await quoteDraftService.upsertFromCalculation(42, DRAFT_KEY, input, calculation)

        expect(converted.update).not.toHaveBeenCalled()
        expect(mockCreate).not.toHaveBeenCalled()
    })

    it("si dos previews simultáneos chocan con el índice único, el perdedor actualiza la fila ya creada", async () => {
        const created = stubExistingDraft({ previewCount: 1 })
        mockFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(created)
        mockCreate.mockRejectedValue(new UniqueConstraintError({}))

        await quoteDraftService.upsertFromCalculation(42, DRAFT_KEY, input, calculation)

        expect(created.update).toHaveBeenCalledWith(expect.objectContaining({ previewCount: 2 }))
    })

    it("propaga cualquier otro error de escritura (el controller decide qué hacer con él)", async () => {
        mockFindOne.mockResolvedValue(null)
        mockCreate.mockRejectedValue(new Error("db down"))

        await expect(quoteDraftService.upsertFromCalculation(42, DRAFT_KEY, input, calculation)).rejects.toThrow("db down")
    })
})

describe("quoteDraftService.markConverted", () => {
    it("marca converted + convertedQuoteId, solo sobre el borrador in_progress de ESE representante", async () => {
        mockUpdate.mockResolvedValue([1])

        await quoteDraftService.markConverted(DRAFT_KEY, 42, 555)

        expect(mockUpdate).toHaveBeenCalledWith(
            { status: "converted", convertedQuoteId: 555 },
            { where: { salespersonId: 42, draftKey: DRAFT_KEY, status: "in_progress" } }
        )
        expectQuoteUntouched()
    })

    it("una clave desconocida o de otro representante no matchea filas: no-op, sin error", async () => {
        mockUpdate.mockResolvedValue([0])

        await expect(quoteDraftService.markConverted(DRAFT_KEY, 99, 555)).resolves.toBeUndefined()
        expect(mockUpdate).toHaveBeenCalledWith(
            expect.anything(),
            { where: { salespersonId: 99, draftKey: DRAFT_KEY, status: "in_progress" } }
        )
    })
})

describe("quoteDraftService.listDrafts", () => {
    const NOW = new Date("2026-09-28T12:00:00.000Z")
    const HOUR = 60 * 60 * 1000

    function stubRow(overrides: Record<string, unknown> = {}) {
        const data: Record<string, unknown> = {
            id: 1,
            status: "in_progress",
            productVariantId: 10,
            productDisplayName: "Piña IQF",
            variantLabel: "Bolsa 500 g",
            requestedPallets: 2,
            totalCost: "284.5000",
            previewCount: 3,
            breakdown: {
                unitMaterials: [{ displayName: "BOLSA", optionGroup: null }],
                palletMaterials: [{ displayName: "CAJA ENVÍO", optionGroup: "Caja" }],
            },
            draftingSalesperson: { id: 42, name: "Rep Uno", companyName: null, email: "uno@legumex.com" },
            createdAt: new Date(NOW.getTime() - 2 * HOUR),
            updatedAt: new Date(NOW.getTime() - HOUR),
            ...overrides,
        }
        return { ...data, get: (key: string) => data[key] }
    }

    it("pide solo borradores in_progress, más reciente primero, con el representante", async () => {
        mockFindAll.mockResolvedValue([])

        await quoteDraftService.listDrafts(undefined, undefined, NOW)

        const args = mockFindAll.mock.calls[0][0]
        expect(args.where).toEqual({ status: "in_progress" })
        expect(args.order).toEqual([["updatedAt", "DESC"]])
        expect(args.include[0]).toEqual(expect.objectContaining({ as: "draftingSalesperson" }))
    })

    // Mismos límites de día en hora de Guatemala (UTC-6) que el dashboard: 00:00 local = 06:00 UTC.
    describe("rango sobre updatedAt (límites de día en hora de Guatemala)", () => {
        function sentWhere() {
            return mockFindAll.mock.calls[0][0].where
        }

        beforeEach(() => {
            mockFindAll.mockResolvedValue([])
        })

        it("ambos → updatedAt entre 00:00 local del inicio y 23:59:59.999 local del fin", async () => {
            await quoteDraftService.listDrafts("2026-09-01", "2026-09-10", NOW)

            const where = sentWhere()
            expect(where.status).toBe("in_progress")
            expect(where.updatedAt[Op.gte]).toEqual(new Date("2026-09-01T06:00:00.000Z"))
            expect(where.updatedAt[Op.lte]).toEqual(new Date("2026-09-11T05:59:59.999Z"))
        })

        it("solo inicio → sin límite superior", async () => {
            await quoteDraftService.listDrafts("2026-09-01", undefined, NOW)

            const updatedAt = sentWhere().updatedAt
            expect(updatedAt[Op.gte]).toEqual(new Date("2026-09-01T06:00:00.000Z"))
            expect(updatedAt[Op.lte]).toBeUndefined()
        })

        it("solo fin → sin límite inferior", async () => {
            await quoteDraftService.listDrafts(undefined, "2026-09-10", NOW)

            const updatedAt = sentWhere().updatedAt
            expect(updatedAt[Op.lte]).toEqual(new Date("2026-09-11T05:59:59.999Z"))
            expect(updatedAt[Op.gte]).toBeUndefined()
        })

        it("una actividad a las 20:00 locales del último día (02:00 UTC del día siguiente) queda dentro", async () => {
            await quoteDraftService.listDrafts("2026-09-10", "2026-09-10", NOW)

            const updatedAt = sentWhere().updatedAt
            const eveningActivity = new Date("2026-09-11T02:00:00.000Z")
            expect(eveningActivity.getTime()).toBeGreaterThanOrEqual(updatedAt[Op.gte].getTime())
            expect(eveningActivity.getTime()).toBeLessThanOrEqual(updatedAt[Op.lte].getTime())
        })
    })

    it("excluye convertidas aunque llegaran del query", async () => {
        mockFindAll.mockResolvedValue([stubRow({ id: 1 }), stubRow({ id: 2, status: "converted" })])

        const result = await quoteDraftService.listDrafts(undefined, undefined, NOW)

        expect(result.map(row => row.id)).toEqual([1])
    })

    it("etiqueta abandonada vs en progreso alrededor del límite de 24h", async () => {
        const limitMs = DRAFT_ABANDONED_AFTER_HOURS * HOUR
        mockFindAll.mockResolvedValue([
            stubRow({ id: 1, updatedAt: new Date(NOW.getTime() - limitMs + 1000) }),
            stubRow({ id: 2, updatedAt: new Date(NOW.getTime() - limitMs) }),
            stubRow({ id: 3, updatedAt: new Date(NOW.getTime() - limitMs - 1000) }),
        ])

        const result = await quoteDraftService.listDrafts(undefined, undefined, NOW)

        expect(result.map(row => [row.id, row.state])).toEqual([
            [1, "in_progress"],
            [2, "abandoned"],
            [3, "abandoned"],
        ])
    })

    it("devuelve la fila lista para el seguimiento (DECIMAL casteado, materiales por nivel, timestamps)", async () => {
        mockFindAll.mockResolvedValue([stubRow()])

        const [row] = await quoteDraftService.listDrafts(undefined, undefined, NOW)

        expect(row).toEqual({
            id: 1,
            salesperson: { id: 42, name: "Rep Uno", companyName: null, email: "uno@legumex.com" },
            productVariantId: 10,
            productDisplayName: "Piña IQF",
            variantLabel: "Bolsa 500 g",
            requestedPallets: 2,
            totalCost: 284.5,
            packaging: {
                unitMaterials: [{ displayName: "BOLSA", optionGroup: null }],
                intermediateMaterials: [],
                palletMaterials: [{ displayName: "CAJA ENVÍO", optionGroup: "Caja" }],
            },
            previewCount: 3,
            startedAt: new Date(NOW.getTime() - 2 * HOUR),
            lastActivityAt: new Date(NOW.getTime() - HOUR),
            state: "in_progress",
        })
        expectQuoteUntouched()
    })
})
