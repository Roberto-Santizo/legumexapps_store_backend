jest.mock("../../../database/connection", () => ({ __esModule: true, default: { transaction: jest.fn() } }))
jest.mock("../models/Juice.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../../product/models/Product.model", () => ({ __esModule: true, default: { findOne: jest.fn(), create: jest.fn() } }))
jest.mock("../../category/models/SubCategory.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../../client/models/Client.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
import sequelize from "../../../database/connection"
import Juice from "../models/Juice.model"
import Product from "../../product/models/Product.model"
import SubCategory from "../../category/models/SubCategory.model"
import Client from "../../client/models/Client.model"
import { linkJuiceProduct } from "./juiceProductLink.service"

const transaction = { LOCK: { UPDATE: "UPDATE" } }
let juice: any
beforeEach(() => {
    jest.resetAllMocks()
    juice = { id: 1, productId: null, clientId: 9, displayName: "Synthetic Juice", imageUrl: null, update: jest.fn().mockResolvedValue(undefined) }
    ;(sequelize.transaction as jest.Mock).mockImplementation(callback => callback(transaction))
    jest.mocked(Juice.findOne).mockResolvedValue(juice)
    jest.mocked(SubCategory.findOne).mockResolvedValue({ id: 2 } as never)
    jest.mocked(Client.findOne).mockResolvedValue({ id: 9 } as never)
    jest.mocked(Product.findOne).mockResolvedValue(null)
    jest.mocked(Product.create).mockResolvedValue({ id: 10 } as never)
})
test("the identity and link use the same transaction and the juice is locked", async () => {
    await expect(linkJuiceProduct(1, 2)).resolves.toEqual({ productId: 10, juiceId: 1 })
    expect(Juice.findOne).toHaveBeenCalledWith(expect.objectContaining({ transaction, lock: "UPDATE" }))
    expect(SubCategory.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2, isActive: true }, include: [expect.objectContaining({ required: true, where: { isActive: true } })], transaction }))
    expect(Product.create).toHaveBeenCalledWith(expect.objectContaining({ subCategoryId: 2, clientId: 9 }), { transaction })
    expect(juice.update).toHaveBeenCalledWith({ productId: 10 }, { transaction })
})
test("a link failure propagates out of the managed transaction instead of committing a partial product", async () => {
    const failure = new Error("Synthetic failure")
    juice.update.mockRejectedValue(failure)
    await expect(linkJuiceProduct(1, 2)).rejects.toBe(failure)
})
test("already linked juices cannot create a second product", async () => {
    juice.productId = 10
    await expect(linkJuiceProduct(1, 2)).rejects.toMatchObject({ statusCode: 409 })
    expect(Product.create).not.toHaveBeenCalled()
})
test("inactive or missing categories and clients prevent creation", async () => {
    jest.mocked(SubCategory.findOne).mockResolvedValueOnce(null)
    await expect(linkJuiceProduct(1, 2)).rejects.toThrow()
    expect(Product.create).not.toHaveBeenCalled()
    jest.mocked(Client.findOne).mockResolvedValueOnce(null)
    await expect(linkJuiceProduct(1, 2)).rejects.toThrow()
    expect(Product.create).not.toHaveBeenCalled()
})
