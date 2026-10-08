import { Router } from "express"
import { quoteDraftController } from "../controllers/quoteDraft.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { listQuoteDraftsQuerySchema } from "../schemas/quoteDraft.schema"

// Seguimiento de cotizaciones sin finalizar -- solo lectura, permiso propio (quoteDrafts:view),
// independiente de quotes:view. Los borradores los escribe únicamente POST /quotes/preview del
// representante (ver quoteController.previewAndTrackDraft).
const adminQuoteDraftRouter = Router()

adminQuoteDraftRouter.use(authenticate)

adminQuoteDraftRouter.get("/", authorize("quoteDrafts:view"), validate(listQuoteDraftsQuerySchema, "query"), quoteDraftController.index)

export default adminQuoteDraftRouter
