import { Router } from "express"
import { quoteReviewController } from "../controllers/quoteReview.controller"
import { validate } from "../../../shared/middlewares/validate"
import { quotePdfUpload } from "../../../shared/middlewares/quotePdfUpload"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { adminQuoteOrderPricingSchema, listQuoteReviewsQuerySchema, quoteOrderIdParamSchema, quoteReviewApproveSchema, quoteReviewClientEmailSchema, quoteReviewPreviewSchema } from "../schemas/quoteReview.schema"

// Revisión gerencial (montado en /admin/quote-reviews). Costos internos y ganancia: solo quotes:review.
// El enlace del correo lleva aquí, pero el permiso lo da el JWT de staff, nunca el correo.
const adminQuoteReviewRouter = Router()

adminQuoteReviewRouter.use(authenticate)

adminQuoteReviewRouter.get("/", authorize("quotes:review"), validate(listQuoteReviewsQuerySchema, "query"), quoteReviewController.index)
adminQuoteReviewRouter.get("/:orderId", authorize("quotes:review"), validate(quoteOrderIdParamSchema, "params"), quoteReviewController.show)
adminQuoteReviewRouter.post("/:orderId/preview", authorize("quotes:review"), validate(quoteOrderIdParamSchema, "params"), validate(quoteReviewPreviewSchema), quoteReviewController.preview)
adminQuoteReviewRouter.post("/:orderId/approve", authorize("quotes:review"), validate(quoteOrderIdParamSchema, "params"), quotePdfUpload, validate(quoteReviewApproveSchema), quoteReviewController.approve)
adminQuoteReviewRouter.post("/:orderId/notify", authorize("quotes:review"), validate(quoteOrderIdParamSchema, "params"), quoteReviewController.notify)
adminQuoteReviewRouter.post("/:orderId/client-email", authorize("quotes:review"), validate(quoteOrderIdParamSchema, "params"), quotePdfUpload, validate(quoteReviewClientEmailSchema), quoteReviewController.clientEmail)
// Calculadora del admin: fija la ganancia de SU pedido (sin revisión).
adminQuoteReviewRouter.put("/:orderId/admin-pricing", authorize("quotes:calculate"), validate(quoteOrderIdParamSchema, "params"), validate(adminQuoteOrderPricingSchema), quoteReviewController.adminPricing)

export default adminQuoteReviewRouter
