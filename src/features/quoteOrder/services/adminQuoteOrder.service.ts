import ProductVariant from "../../product/models/ProductVariant.model"
import Product from "../../product/models/Product.model"
import Client from "../../client/models/Client.model"
import { NotFoundError } from "../../../shared/errors/AppError"
import type { QuoteOrderIdentity } from "../schemas/quoteOrder.schema"

// Pedido del cotizador admin: el cliente sale del producto cotizado (Product.clientId), nunca del
// navegador. Las validaciones de activo/cotizable las hace el cálculo que corre después.
export async function resolveAdminQuoteOrder(orderId: string, variantId: number): Promise<QuoteOrderIdentity> {
    const variant = await ProductVariant.findOne({ where: { id: variantId }, attributes: ["productId"] })
    const product = variant && await Product.findOne({ where: { id: variant.productId }, attributes: ["clientId"] })
    const client = product && await Client.findOne({ where: { id: product.clientId }, attributes: ["id", "name"] })
    if (!client) throw new NotFoundError("ProductVariant", variantId)
    return { id: orderId, clientId: client.id, clientName: client.name }
}
