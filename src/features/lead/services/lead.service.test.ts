import "reflect-metadata"

// Mock manual del modelo -- mismo patrón que quote.service.test.ts/packaging.service.test.ts:
// solo se mockean los métodos de Sequelize que la función realmente llama.
jest.mock("../models/Lead.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), create: jest.fn() }
}))

import Lead from "../models/Lead.model"
import { leadService } from "./lead.service"

const mockLeadFindOne = Lead.findOne as unknown as jest.Mock
const mockLeadCreate = Lead.create as unknown as jest.Mock

// Los Leads nacen únicamente del formulario público de la landing (el cotizador ya no captura ni
// vincula prospectos) -- estas pruebas cubren esa vía y el panel admin.
describe("leadService (formulario público + panel admin)", () => {
    beforeEach(() => {
        mockLeadFindOne.mockReset()
        mockLeadCreate.mockReset()
    })

    it("createLead persiste exactamente los datos del formulario público", async () => {
        const input = {
            fullName: "Juan Pérez",
            companyName: "Comercial Pérez",
            phone: "5555-1234",
            email: "juan@example.com",
            productLineInterest: "Jugos",
            notes: "Interesado en jugos",
        }
        mockLeadCreate.mockResolvedValue({ id: 1, ...input })

        const result = await leadService.createLead(input)

        expect(mockLeadCreate).toHaveBeenCalledWith(input)
        expect(result).toEqual({ id: 1, ...input })
    })

    it("getLeadById busca solo por id (ya no incluye cotizaciones vinculadas)", async () => {
        mockLeadFindOne.mockResolvedValue({ id: 7 })

        await leadService.getLeadById(7)

        expect(mockLeadFindOne).toHaveBeenCalledWith({ where: { id: 7 } })
    })

    it("getLeadById lanza NotFoundError si el prospecto no existe", async () => {
        mockLeadFindOne.mockResolvedValue(null)

        await expect(leadService.getLeadById(999)).rejects.toMatchObject({ statusCode: 404 })
    })

    it("updateLead actualiza status/notes del prospecto existente", async () => {
        const update = jest.fn().mockResolvedValue({ id: 7, status: "contacted" })
        mockLeadFindOne.mockResolvedValue({ id: 7, update })

        await leadService.updateLead(7, { status: "contacted", notes: "llamado" })

        expect(update).toHaveBeenCalledWith({ status: "contacted", notes: "llamado" })
    })
})
