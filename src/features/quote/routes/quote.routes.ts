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
// Recálculo en vivo: misma respuesta que /admin/quotes/preview y NUNCA guarda una Quote. El wizard
// lo llama con debounce al cambiar materiales, palets o SKU. A diferencia del admin, si llega
// draftKey registra el borrador del intento (ver quoteController.previewAndTrackDraft).
quoteRouter.post("/preview", validate(salespersonQuoteSchema), quoteController.previewAndTrackDraft)
quoteRouter.post("/", validate(salespersonQuoteSchema), quoteController.save)
quoteRouter.post("/send-email", upload.single("file"), validate(sendQuotePdfEmailSchema), quoteController.sendPdfEmail)

export default quoteRouter
