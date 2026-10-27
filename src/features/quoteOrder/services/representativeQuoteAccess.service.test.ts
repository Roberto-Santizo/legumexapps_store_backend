jest.mock("../../product/models/Product.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../../client/models/Client.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../../product/models/ProductVariant.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../../salesperson/services/representativeClient.service", () => ({ representativeClientService: { authorizedClientIds: jest.fn() } }))
import { Op } from "sequelize"
import Product from "../../product/models/Product.model"
import Variant from "../../product/models/ProductVariant.model"
import { representativeClientService } from "../../salesperson/services/representativeClient.service"
import { requireRepresentativeVariantAccess, requireRepresentativeOrder } from "./representativeQuoteAccess.service"
import Client from "../../client/models/Client.model"
beforeEach(() => jest.resetAllMocks())

const order = { id: "72db466a-e594-48b7-9864-128b4b305b08", clientName: "Forged name", clientId: 11 }
test("existing customers use the authoritative database name and require a live assignment", async () => {
    jest.mocked(representativeClientService.authorizedClientIds).mockResolvedValue([11, 12])
    jest.mocked(Client.findOne).mockResolvedValue({ id: 11, name: "Walmart" } as never)
    await expect(requireRepresentativeOrder(7, order, true)).resolves.toEqual({ ...order, clientName: "Walmart" })
    await expect(requireRepresentativeOrder(7, { ...order, clientId: 99 }, true)).rejects.toMatchObject({ statusCode: 403 })
})
test.each([undefined, {}, { ...order, clientId: undefined }, { ...order, clientId: "11" }, { ...order, clientName: " " }])("malformed customer contexts fail closed: %p", async input => {
    await expect(requireRepresentativeOrder(7, input, true)).rejects.toMatchObject({ statusCode: 400 })
    expect(Client.findOne).not.toHaveBeenCalled()
})
test("new customers are accepted only for new products and never create a catalog customer", async () => {
    const newOrder = { ...order, clientId: null, clientName: "New prospect" }
    await expect(requireRepresentativeOrder(7, newOrder, false)).resolves.toEqual(newOrder)
    await expect(requireRepresentativeOrder(7, newOrder, true)).rejects.toMatchObject({ statusCode: 400 })
    expect(Client.findOne).not.toHaveBeenCalled()
})
test("an assigned HEB product cannot be quoted with Walmart selected", async () => {
    jest.mocked(representativeClientService.authorizedClientIds).mockResolvedValue([11, 12])
    jest.mocked(Variant.findOne).mockResolvedValue({ productId: 21 } as never)
    jest.mocked(Product.findOne).mockResolvedValue(null)
    await expect(requireRepresentativeVariantAccess(7, 31, 11)).rejects.toMatchObject({ statusCode: 403 })
    expect(Product.findOne).toHaveBeenCalledWith({ where: { id: 21, isActive: true, clientId: 11 }, attributes: ["id"] })
})
test("ACME/Walmart assignment limits the product lookup and permits an assigned product", async () => {
    jest.mocked(representativeClientService.authorizedClientIds).mockResolvedValue([11, 12])
    jest.mocked(Variant.findOne).mockResolvedValue({ productId: 20 } as never)
    jest.mocked(Product.findOne).mockResolvedValue({ id: 20 } as never)
    await expect(requireRepresentativeVariantAccess(7, 30)).resolves.toBeUndefined()
    expect(Product.findOne).toHaveBeenCalledWith({ where: { id: 20, isActive: true, clientId: { [Op.in]: [11, 12] } }, attributes: ["id"] })
})
test("HEB product outside assigned clients is forbidden", async () => {
    jest.mocked(representativeClientService.authorizedClientIds).mockResolvedValue([11, 12])
    jest.mocked(Variant.findOne).mockResolvedValue({ productId: 21 } as never)
    jest.mocked(Product.findOne).mockResolvedValue(null)
    await expect(requireRepresentativeVariantAccess(7, 31)).rejects.toMatchObject({ statusCode: 403 })
})
test("no assignments fails closed without looking up products", async () => {
    jest.mocked(representativeClientService.authorizedClientIds).mockResolvedValue([])
    await expect(requireRepresentativeVariantAccess(7, 30)).rejects.toMatchObject({ key: "errors.forbidden" })
    expect(Variant.findOne).not.toHaveBeenCalled()
    expect(Product.findOne).not.toHaveBeenCalled()
})
test("assignments are checked again on each request", async () => {
    jest.mocked(representativeClientService.authorizedClientIds).mockResolvedValueOnce([11]).mockResolvedValueOnce([])
    jest.mocked(Variant.findOne).mockResolvedValue({ productId: 20 } as never)
    jest.mocked(Product.findOne).mockResolvedValue({ id: 20 } as never)
    await requireRepresentativeVariantAccess(7, 30)
    await expect(requireRepresentativeVariantAccess(7, 30)).rejects.toMatchObject({ key: "errors.forbidden" })
})
