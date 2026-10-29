import type { Transaction } from "sequelize"
import QuoteOrderReview from "../models/QuoteOrderReview.model"
import { AppError } from "../../../shared/errors/AppError"

// Bloqueo por pedido (hasta el fin de la transacción): lo comparten la revisión (enviar, aprobar,
// ganancia del admin) y el guardado de líneas, para que nunca se agregue una línea mientras otro
// proceso aprueba ese mismo pedido.
export async function lockQuoteOrder(orderId: string, transaction: Transaction): Promise<void> {
    await QuoteOrderReview.sequelize!.query("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))", { replacements: { key: `quote-review:${orderId}` }, transaction })
}

// Antes de guardar una línea en un pedido: un pedido del representante ya aprobado no admite más
// líneas (su precio final y el PDF enviado al cliente no las incluyen); hay que empezar otro. Los del
// admin siguen abiertos: el admin vuelve a aplicar su ganancia.
// La transacción debe ser READ COMMITTED: así la lectura, posterior al bloqueo, ve la última versión
// confirmada, y ninguna revisión puede crearse ni aprobarse hasta que esta transacción termine. En
// REPEATABLE READ la foto se toma en la primera sentencia, antes de obtener el bloqueo, y no vería una
// revisión creada o aprobada mientras tanto.
export async function assertQuoteOrderOpen(orderId: string, transaction: Transaction): Promise<void> {
    await lockQuoteOrder(orderId, transaction)
    const review = await QuoteOrderReview.findOne({ where: { orderId }, attributes: ["id", "status", "salespersonId"], transaction })
    if (review?.status === "approved" && review.salespersonId != null) throw new AppError(409, "errors.quote_review_already_approved")
}
