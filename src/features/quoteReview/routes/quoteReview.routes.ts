import { Router } from "express"
import { quoteReviewController } from "../controllers/quoteReview.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticateSalesperson } from "../../../shared/middlewares/authenticateSalesperson"
import { quoteOrderIdParamSchema, quoteReviewSubmitSchema } from "../schemas/quoteReview.schema"

// Representante (montado en /quote-reviews): solo sus propios pedidos; nunca recibe costos ni ganancia.
const quoteReviewRouter = Router()

quoteReviewRouter.use(authenticateSalesperson)

quoteReviewRouter.post("/:orderId", validate(quoteOrderIdParamSchema, "params"), validate(quoteReviewSubmitSchema), quoteReviewController.submit)
quoteReviewRouter.get("/:orderId", validate(quoteOrderIdParamSchema, "params"), quoteReviewController.status)

export default quoteReviewRouter
