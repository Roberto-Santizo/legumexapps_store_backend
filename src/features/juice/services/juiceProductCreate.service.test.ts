jest.mock("../../../database/connection", () => ({ __esModule: true, default: { transaction: jest.fn() } }))
jest.mock("./juiceCatalog.service", () => ({ juiceService: { create: jest.fn() } }))
jest.mock("./juiceProductLink.service", () => ({ linkJuiceProduct: jest.fn() }))
import sequelize from "../../../database/connection"
import { juiceService } from "./juiceCatalog.service"
import { linkJuiceProduct } from "./juiceProductLink.service"
import { createLinkedJuice } from "./juiceProductCreate.service"
const transaction = { synthetic: true }
const input = { code: "SYN-J", displayName: "Synthetic juice", clientId: 9, subCategoryId: 2 }
let stored: unknown[]
beforeEach(() => {
    jest.resetAllMocks()
    stored = []
    ;(sequelize.transaction as jest.Mock).mockImplementation(async callback => {
        try { return await callback(transaction) } catch (error) { stored = []; throw error }
    })
    jest.mocked(juiceService.create).mockImplementation(async () => { stored.push({ id: 1 }); return { id: 1 } as never })
    jest.mocked(linkJuiceProduct).mockResolvedValue({ productId: 8, juiceId: 1 })
})
test("creating juice and its commercial identity uses one managed transaction", async () => {
    await expect(createLinkedJuice(input)).resolves.toEqual({ id: 1, productId: 8 })
    expect(juiceService.create).toHaveBeenCalledWith({ code: input.code, displayName: input.displayName, clientId: 9 }, transaction)
    expect(linkJuiceProduct).toHaveBeenCalledWith(1, 2, transaction)
})
test("invalid category or link failure rolls back the juice too", async () => {
    const error = new Error("Synthetic invalid category")
    jest.mocked(linkJuiceProduct).mockRejectedValue(error)
    await expect(createLinkedJuice(input)).rejects.toBe(error)
    expect(stored).toEqual([])
})
test("missing subcategory is rejected before starting a transaction", async () => {
    await expect(createLinkedJuice({ ...input, subCategoryId: undefined })).rejects.toThrow()
    expect(sequelize.transaction).not.toHaveBeenCalled()
})

test("invalid created juice uses the existing internal error translation and never links", async () => {
    jest.mocked(juiceService.create).mockResolvedValue({} as never)
    await expect(createLinkedJuice(input)).rejects.toMatchObject({ key: "errors.internal", statusCode: 500 })
    expect(linkJuiceProduct).not.toHaveBeenCalled()
})
