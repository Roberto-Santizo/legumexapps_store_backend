import "reflect-metadata"
import { Op } from "sequelize"

// Mock manual del modelo -- mismo patrón que quote.service.test.ts/packaging.service.test.ts:
// solo se mockean los métodos de Sequelize que la función realmente llama.
jest.mock("../models/Lead.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), create: jest.fn() }
}))
jest.mock("../../quote/models/Quote.model", () => ({
    __esModule: true,
    default: {}
}))

import Lead from "../models/Lead.model"
import { leadService } from "./lead.service"

const mockLeadFindOne = Lead.findOne as unknown as jest.Mock
const mockLeadCreate = Lead.create as unknown as jest.Mock

const CONTACT = { fullName: "Juan Pérez", companyName: "Comercial Pérez", email: "juan@example.com", notes: "Interesado en jugos" }

describe("leadService.findOrCreateLeadForQuote (crear-o-reusar, 2026-09-13)", () => {
    beforeEach(() => {
        mockLeadFindOne.mockReset()
        mockLeadCreate.mockReset()
    })

    it("reusa un Lead existente si ya hay uno con ese email -- no llama a Lead.create", async () => {
        const existingLead = { id: 7, fullName: "Nombre viejo", email: "juan@example.com", status: "contacted", notes: "nota del admin" }
        mockLeadFindOne.mockResolvedValue(existingLead)

        const result = await leadService.findOrCreateLeadForQuote(CONTACT)

        expect(result).toBe(existingLead)
        expect(mockLeadCreate).not.toHaveBeenCalled()
    })

    it("la búsqueda de email es case-insensitive (Op.iLike)", async () => {
        mockLeadFindOne.mockResolvedValue({ id: 7 })

        await leadService.findOrCreateLeadForQuote({ ...CONTACT, email: "JUAN@EXAMPLE.COM" })

        expect(mockLeadFindOne).toHaveBeenCalledWith(
            expect.objectContaining({ where: { email: { [Op.iLike]: "JUAN@EXAMPLE.COM" } } })
        )
    })

    it("al reusar, NO sobreescribe fullName/companyName/notes/status que el admin ya haya editado (no llama a update)", async () => {
        const existingLead = {
            id: 7,
            fullName: "Nombre distinto al del form",
            companyName: "Empresa distinta",
            status: "contacted",
            notes: "notas ya escritas por el admin",
            update: jest.fn(),
        }
        mockLeadFindOne.mockResolvedValue(existingLead)

        const result = await leadService.findOrCreateLeadForQuote(CONTACT)

        expect(result).toBe(existingLead)
        expect(existingLead.update).not.toHaveBeenCalled()
    })

    it("crea un Lead nuevo cuando no existe ninguno con ese email", async () => {
        mockLeadFindOne.mockResolvedValue(null)
        mockLeadCreate.mockResolvedValue({ id: 500, ...CONTACT })

        const result = await leadService.findOrCreateLeadForQuote(CONTACT)

        expect(result).toEqual({ id: 500, ...CONTACT })
        expect(mockLeadCreate).toHaveBeenCalledWith({
            fullName: CONTACT.fullName,
            companyName: CONTACT.companyName,
            email: CONTACT.email,
            notes: CONTACT.notes,
            phone: null,
            productLineInterest: null,
        })
    })

    it("crea con notes: null cuando el cotizador no manda notas (campo opcional)", async () => {
        mockLeadFindOne.mockResolvedValue(null)
        mockLeadCreate.mockResolvedValue({ id: 501 })

        await leadService.findOrCreateLeadForQuote({ fullName: "Ana Ruiz", companyName: "Ruiz SA", email: "ana@example.com", notes: undefined })

        expect(mockLeadCreate).toHaveBeenCalledWith(
            expect.objectContaining({ notes: null, phone: null, productLineInterest: null })
        )
    })
})
