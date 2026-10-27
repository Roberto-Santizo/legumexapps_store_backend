import { adminQuoteListQuerySchema } from "../schemas/adminQuoteList.schema"
import { Router } from "express"
import multer from "multer"
import { quoteController } from "../controllers/quote.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { adminSaveQuoteSchema, adminSendQuotePdfEmailSchema, calculateQuoteSchema } from "../schemas/quote.schema"

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
})

const adminQuoteRouter = Router()

adminQuoteRouter.use(authenticate)

adminQuoteRouter.get("/", authorize("quotes:view"), validate(adminQuoteListQuerySchema, "query"), quoteController.indexAll)
adminQuoteRouter.get("/production-orders", authorize("quotes:view"), authorize("customQuotes:view"), validate(adminQuoteListQuerySchema, "query"), quoteController.productionOrders)

adminQuoteRouter.get("/products", authorize("quotes:calculate"), quoteController.products)
adminQuoteRouter.get("/destinations", authorize("quotes:calculate"), quoteController.destinations)
adminQuoteRouter.post("/preview", authorize("quotes:calculate"), validate(calculateQuoteSchema), quoteController.preview)
// Guardar desde el cotizador del admin: queda en el listado y en el dashboard como las del representante.
adminQuoteRouter.post("/", authorize("quotes:calculate"), validate(adminSaveQuoteSchema), quoteController.saveAdmin)
adminQuoteRouter.post(
    "/send-email",
    authorize("quotes:calculate"),
    upload.single("file"),
    validate(adminSendQuotePdfEmailSchema),
    quoteController.sendAdminPdfEmail
)

export default adminQuoteRouter
