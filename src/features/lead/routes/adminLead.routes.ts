import { Router } from "express"
import { leadController } from "../controllers/lead.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { leadIdParamSchema, leadQuerySchema, updateLeadSchema } from "../schemas/lead.schema"

const adminLeadRouter = Router()

adminLeadRouter.use(authenticate)

adminLeadRouter.get("/", authorize("leads:view"), validate(leadQuerySchema, "query"), leadController.index)
adminLeadRouter.get("/:id", authorize("leads:view"), validate(leadIdParamSchema, "params"), leadController.show)
adminLeadRouter.patch(
    "/:id",
    authorize("leads:edit"),
    validate(leadIdParamSchema, "params"),
    validate(updateLeadSchema),
    leadController.update
)

export default adminLeadRouter
