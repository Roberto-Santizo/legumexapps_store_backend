import { Router } from "express"
import { quoteController } from "../controllers/quote.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticateSalesperson } from "../../../shared/middlewares/authenticateSalesperson"
import { salespersonQuoteSchema } from "../schemas/quote.schema"

const quoteRouter = Router()

quoteRouter.use(authenticateSalesperson)

quoteRouter.get("/products", quoteController.products)
quoteRouter.get("/clients", quoteController.clients)
quoteRouter.get("/destinations", quoteController.representativeDestinations)
// Recálculo en vivo: mismo cálculo que /admin/quotes/preview, pero la respuesta va sin montos (vista
// del representante) y NUNCA guarda una Quote. El wizard
// lo llama con debounce al cambiar materiales, palets o SKU. A diferencia del admin, si llega
// draftKey registra el borrador del intento (ver quoteController.previewAndTrackDraft).
quoteRouter.post("/preview", validate(salespersonQuoteSchema), quoteController.previewAndTrackDraft)
quoteRouter.post("/", validate(salespersonQuoteSchema), quoteController.save)
// Sin envío por correo: el representante no puede mandar una cotización por su cuenta. Solo gerencia
// (quotes:review, /admin/quote-reviews) autoriza el envío comercial de sus pedidos.

export default quoteRouter
