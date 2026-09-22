import { Router } from "express"
import { salespersonController } from "../controllers/salesperson.controller"
import { createSalespersonSchema, salespersonIdParamSchema, updateSalespersonSchema, updateSalespersonStatusSchema, salespersonQuerySchema } from "../schemas/salesperson.schema"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"

const salespersonRouter = Router()

salespersonRouter.use(authenticate)

salespersonRouter.get("/", authorize("salespeople:view"), validate(salespersonQuerySchema, "query"), salespersonController.index)
salespersonRouter.get("/:id", authorize("salespeople:view"), validate(salespersonIdParamSchema, "params"), salespersonController.show)
salespersonRouter.post("/", authorize("salespeople:create"), validate(createSalespersonSchema), salespersonController.store)
salespersonRouter.patch(
    "/:id",
    authorize("salespeople:edit"),
    validate(salespersonIdParamSchema, "params"),
    validate(updateSalespersonSchema),
    salespersonController.update
)
salespersonRouter.patch(
    "/:id/status",
    authorize("salespeople:edit"),
    validate(salespersonIdParamSchema, "params"),
    validate(updateSalespersonStatusSchema),
    salespersonController.updateStatus
)
salespersonRouter.delete("/:id", authorize("salespeople:delete"), validate(salespersonIdParamSchema, "params"), salespersonController.destroy)

export default salespersonRouter
