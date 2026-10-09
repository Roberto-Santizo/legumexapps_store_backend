import { adminQuoteListQuerySchema } from "../schemas/adminQuoteList.schema"
import { Router } from "express"
import multer from "multer"
import { quoteController } from "../controllers/quote.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { calculateQuoteSchema, sendQuotePdfEmailSchema } from "../schemas/quote.schema"
import { adminCatalogQuoteController } from "../../customQuote/controllers/adminCatalogQuote.controller"
import { catalogQuoteInputSchema } from "../../customQuote/schemas/catalogQuote.schema"

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
})

const adminQuoteRouter = Router()

adminQuoteRouter.use(authenticate)

adminQuoteRouter.get("/", authorize("quotes:view"), validate(adminQuoteListQuerySchema, "query"), quoteController.indexAll)
adminQuoteRouter.get("/production-orders", authorize("quotes:view"), authorize("customQuotes:view"), validate(adminQuoteListQuerySchema, "query"), quoteController.productionOrders)

adminQuoteRouter.get("/products", authorize("quotes:calculate"), quoteController.products)
adminQuoteRouter.get("/catalog-configurations", authorize("quotes:calculate"), adminCatalogQuoteController.catalog)
adminQuoteRouter.post("/catalog-preview", authorize("quotes:calculate"), validate(catalogQuoteInputSchema), adminCatalogQuoteController.preview)
adminQuoteRouter.get("/destinations", authorize("quotes:calculate"), quoteController.destinations)
adminQuoteRouter.post("/preview", authorize("quotes:calculate"), validate(calculateQuoteSchema), quoteController.preview)
adminQuoteRouter.post(
    "/send-email",
    authorize("quotes:calculate"),
    upload.single("file"),
    validate(sendQuotePdfEmailSchema),
    quoteController.sendPdfEmail
)

export default adminQuoteRouter
