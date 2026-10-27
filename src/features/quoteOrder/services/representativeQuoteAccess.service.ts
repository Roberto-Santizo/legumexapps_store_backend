import { Op } from "sequelize"
import Product from "../../product/models/Product.model"
import ProductVariant from "../../product/models/ProductVariant.model"
import { representativeClientService } from "../../salesperson/services/representativeClient.service"
import { AppError } from "../../../shared/errors/AppError"
import Client from "../../client/models/Client.model"
import { quoteOrderSchema, QuoteOrderIdentity } from "../schemas/quoteOrder.schema"

export async function requireRepresentativeOrder(representativeId: number, input: unknown, fixed: boolean): Promise<QuoteOrderIdentity> {
    const parsed = quoteOrderSchema.safeParse(input)
    if (!parsed.success || parsed.data.clientId === undefined || (fixed && parsed.data.clientId === null)) {
        throw new AppError(400, "errors.quote_client_required")
    }
    const order = parsed.data
    if (order.clientId === null) return order
    const ids = await representativeClientService.authorizedClientIds(representativeId)
    if (!ids.includes(order.clientId!)) throw new AppError(403, "errors.forbidden")
    const client = await Client.findOne({ where: { id: order.clientId, isActive: true }, attributes: ["id", "name"] })
    if (!client) throw new AppError(403, "errors.forbidden")
    return { ...order, clientName: client.name }
}

export async function requireRepresentativeVariantAccess(representativeId: number, variantId: number, selectedClientId?: number): Promise<void> {
    const clientIds = await representativeClientService.authorizedClientIds(representativeId)
    if (!clientIds.length || (selectedClientId !== undefined && !clientIds.includes(selectedClientId))) throw new AppError(403, "errors.forbidden")
    const variant = await ProductVariant.findOne({ where: { id: variantId, isActive: true }, attributes: ["productId"] })
    const product = variant && await Product.findOne({ where: { id: variant.productId, isActive: true, clientId: selectedClientId ?? { [Op.in]: clientIds } }, attributes: ["id"] })
    if (!product) throw new AppError(403, "errors.forbidden")
}
