import { Router } from "express"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { adminCatalogQuoteController } from "../controllers/adminCatalogQuote.controller"
import { catalogQuoteInputSchema } from "../schemas/catalogQuote.schema"

// Calculadora interna del staff para productos personalizables: montada en /admin/quotes junto al
// router de cotizaciones. Autenticación por ruta (no router.use) para no afectar a las demás rutas del prefijo.
const adminCatalogQuoteRouter = Router()

adminCatalogQuoteRouter.get("/catalog-configurations", authenticate, authorize("quotes:calculate"), adminCatalogQuoteController.catalog)
adminCatalogQuoteRouter.post("/catalog-preview", authenticate, authorize("quotes:calculate"), validate(catalogQuoteInputSchema), adminCatalogQuoteController.preview)

export default adminCatalogQuoteRouter
