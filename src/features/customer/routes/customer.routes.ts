import { Router } from "express"
import { customerController } from "../controllers/customer.controller"
import { createCustomerSchema, customerIdParamSchema, updateCustomerSchema, updateCustomerStatusSchema, customerQuerySchema } from "../schemas/customer.schema"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"

const customerRouter = Router()

customerRouter.use(authenticate)

customerRouter.get("/", authorize("customers:view"), validate(customerQuerySchema, "query"), customerController.index)
customerRouter.get("/:id", authorize("customers:view"), validate(customerIdParamSchema, "params"), customerController.show)
customerRouter.post("/", authorize("customers:create"), validate(createCustomerSchema), customerController.store)
customerRouter.patch(
    "/:id",
    authorize("customers:edit"),
    validate(customerIdParamSchema, "params"),
    validate(updateCustomerSchema),
    customerController.update
)
customerRouter.patch(
    "/:id/status",
    authorize("customers:edit"),
    validate(customerIdParamSchema, "params"),
    validate(updateCustomerStatusSchema),
    customerController.updateStatus
)
customerRouter.delete("/:id", authorize("customers:delete"), validate(customerIdParamSchema, "params"), customerController.destroy)

export default customerRouter
