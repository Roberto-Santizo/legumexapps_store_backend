import { Router } from "express"
import { customQuoteController } from "../controllers/customQuote.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticateSalesperson } from "../../../shared/middlewares/authenticateSalesperson"
import { customQuoteCalculationSchema } from "../schemas/customQuote.schema"

// Cotizaciones a la medida del representante (montado en /custom-quotes, JWT de representante, igual
// que /quotes): el menú, el cálculo en vivo (nunca escribe) y guardar (escribe solo en customQuotes).
const customQuoteRouter = Router()

customQuoteRouter.use(authenticateSalesperson)

customQuoteRouter.get("/catalog", customQuoteController.catalog)
customQuoteRouter.post("/preview", validate(customQuoteCalculationSchema), customQuoteController.preview)
customQuoteRouter.post("/", validate(customQuoteCalculationSchema), customQuoteController.save)

export default customQuoteRouter
