import { Router } from "express"
import multer from "multer"
import { quoteController } from "../controllers/quote.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticateSalesperson } from "../../../shared/middlewares/authenticateSalesperson"
import { calculateQuoteSchema, sendQuotePdfEmailSchema } from "../schemas/quote.schema"

const quoteRouter = Router()

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
})

quoteRouter.use(authenticateSalesperson)

quoteRouter.get("/products", quoteController.products)
quoteRouter.get("/destinations", quoteController.destinations)
// Recalculo en vivo (2026-09-21, ver CLAUDE.md #6) -- mirrors /admin/quotes/preview EXACTAMENTE:
// solo calcula (calculateQuote), NUNCA guarda (saveQuote es una garantía estructural, no una
// convención). El wizard lo llama con debounce cada vez que el cliente cambia de opción en
// cualquier grupo de materiales (o de palets/SKU), para mostrar el total actualizado antes del submit final (que sigue
// siendo POST /quotes, guardar en un solo paso).
quoteRouter.post("/preview", validate(calculateQuoteSchema), quoteController.preview)
quoteRouter.post("/", validate(calculateQuoteSchema), quoteController.save)
quoteRouter.post("/send-email", upload.single("file"), validate(sendQuotePdfEmailSchema), quoteController.sendPdfEmail)

export default quoteRouter
