import { Router } from "express"
import { adminCustomQuoteController } from "../controllers/adminCustomQuote.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import {
    customQuoteIdParamSchema,
    listCustomQuotesQuerySchema,
    updateCustomQuoteStatusSchema
} from "../schemas/adminCustomQuote.schema"

// Seguimiento admin de cotizaciones a la medida (montado en /admin/custom-quotes). Permisos propios,
// independientes de quotes:* (otra tabla, otro flujo): customQuotes:view para leer, customQuotes:edit
// para mover el estado. No hay crear/editar/eliminar desde acá: solo las crea el representante.
const adminCustomQuoteRouter = Router()

adminCustomQuoteRouter.use(authenticate)

adminCustomQuoteRouter.get(
    "/",
    authorize("customQuotes:view"),
    validate(listCustomQuotesQuerySchema, "query"),
    adminCustomQuoteController.index
)
adminCustomQuoteRouter.get(
    "/:id",
    authorize("customQuotes:view"),
    validate(customQuoteIdParamSchema, "params"),
    adminCustomQuoteController.show
)
adminCustomQuoteRouter.patch(
    "/:id/status",
    authorize("customQuotes:edit"),
    validate(customQuoteIdParamSchema, "params"),
    validate(updateCustomQuoteStatusSchema),
    adminCustomQuoteController.updateStatus
)

export default adminCustomQuoteRouter
