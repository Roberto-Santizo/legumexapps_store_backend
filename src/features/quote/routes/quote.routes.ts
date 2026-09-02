import { Router } from "express"
import multer from "multer"
import { quoteController } from "../controllers/quote.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticateCustomer } from "../../../shared/middlewares/authenticateCustomer"
import { calculateQuoteSchema, sendQuotePdfEmailSchema } from "../schemas/quote.schema"

const quoteRouter = Router()

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
})

quoteRouter.use(authenticateCustomer)

quoteRouter.get("/products", quoteController.products)
quoteRouter.get("/destinations", quoteController.destinations)
quoteRouter.get("/exchange-rate", quoteController.exchangeRate)
quoteRouter.post("/", validate(calculateQuoteSchema), quoteController.save)
quoteRouter.post("/send-email", upload.single("file"), validate(sendQuotePdfEmailSchema), quoteController.sendPdfEmail)

export default quoteRouter
