import { Router } from "express"
import multer from "multer"
import { quoteController } from "../controllers/quote.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { calculateQuoteSchema, sendQuotePdfEmailSchema } from "../schemas/quote.schema"

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
})

const adminQuoteRouter = Router()

adminQuoteRouter.use(authenticate)

adminQuoteRouter.get("/", authorize("quotes:view"), quoteController.indexAll)

adminQuoteRouter.get("/products", authorize("quotes:calculate"), quoteController.products)
adminQuoteRouter.get("/destinations", authorize("quotes:calculate"), quoteController.destinations)
adminQuoteRouter.post("/preview", authorize("quotes:calculate"), validate(calculateQuoteSchema), quoteController.previewForAdmin)
adminQuoteRouter.post(
    "/send-email",
    authorize("quotes:calculate"),
    upload.single("file"),
    validate(sendQuotePdfEmailSchema),
    quoteController.sendPdfEmail
)

export default adminQuoteRouter
