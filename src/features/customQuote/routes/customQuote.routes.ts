import { Router } from "express"
import { validate } from "../../../shared/middlewares/validate"
import { authenticateSalesperson } from "../../../shared/middlewares/authenticateSalesperson"
import { catalogQuoteController } from "../controllers/catalogQuote.controller"
import { catalogQuoteConfirmSchema, catalogQuoteInputSchema } from "../schemas/catalogQuote.schema"

// Customize basado en el catálogo. Los snapshots legacy siguen disponibles en la administración;
// sus antiguos endpoints de catálogo, preview y creación ya no se exponen.
const customQuoteRouter = Router()

customQuoteRouter.use(authenticateSalesperson)
customQuoteRouter.get("/configurations", catalogQuoteController.catalog)
customQuoteRouter.post("/catalog-preview", validate(catalogQuoteInputSchema), catalogQuoteController.preview)
customQuoteRouter.post("/catalog-confirm", validate(catalogQuoteConfirmSchema), catalogQuoteController.confirm)

export default customQuoteRouter
