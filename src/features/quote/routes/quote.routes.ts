import { Router } from "express"
import multer from "multer"
import { quoteController } from "../controllers/quote.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticateSalesperson } from "../../../shared/middlewares/authenticateSalesperson"
import { salespersonQuoteSchema, sendQuotePdfEmailSchema } from "../schemas/quote.schema"

const quoteRouter = Router()

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
})

quoteRouter.use(authenticateSalesperson)

quoteRouter.get("/products", quoteController.products)
quoteRouter.get("/destinations", quoteController.destinations)
// Recalculo en vivo: misma respuesta que /admin/quotes/preview y NUNCA guarda una Quote (saveQuote
// es una garantía estructural, no una convención). El wizard lo llama con debounce cada vez que el
// representante cambia de opción en cualquier grupo de materiales (o de palets/SKU), para mostrar el
// total actualizado antes del submit final (que sigue siendo POST /quotes, guardar en un solo paso).
// A diferencia del admin, si llega draftKey registra el borrador del intento (quoteDraft/) para el
// seguimiento de cotizaciones sin finalizar -- ver quoteController.previewAndTrackDraft.
quoteRouter.post("/preview", validate(salespersonQuoteSchema), quoteController.previewAndTrackDraft)
quoteRouter.post("/", validate(salespersonQuoteSchema), quoteController.save)
quoteRouter.post("/send-email", upload.single("file"), validate(sendQuotePdfEmailSchema), quoteController.sendPdfEmail)

export default quoteRouter
