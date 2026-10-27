jest.mock("../../product/models/ProductVariant.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../../product/models/Product.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../../client/models/Client.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))

import ProductVariant from "../../product/models/ProductVariant.model"
import Product from "../../product/models/Product.model"
import Client from "../../client/models/Client.model"
import { resolveAdminQuoteOrder } from "./adminQuoteOrder.service"

const orderId = "5e226064-21be-4a9a-a5e5-f312391e363a"

test("takes the customer from the quoted product, not from the browser", async () => {
    ;(ProductVariant.findOne as jest.Mock).mockResolvedValue({ productId: 8 })
    ;(Product.findOne as jest.Mock).mockResolvedValue({ clientId: 11 })
    ;(Client.findOne as jest.Mock).mockResolvedValue({ id: 11, name: "Cliente real" })
    await expect(resolveAdminQuoteOrder(orderId, 10)).resolves.toEqual({ id: orderId, clientId: 11, clientName: "Cliente real" })
    expect(Client.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 11 } }))
})

test("an unknown variant is a 404", async () => {
    ;(ProductVariant.findOne as jest.Mock).mockResolvedValue(null)
    await expect(resolveAdminQuoteOrder(orderId, 10)).rejects.toMatchObject({ statusCode: 404 })
})
