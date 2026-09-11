import { Router } from "express"
import { processingCostController } from "../controllers/processingCost.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import {
    createProcessingCostSchema,
    updateProcessingCostSchema,
    processingCostIdParamSchema,
    processingCostQuerySchema,
} from "../schemas/processingCost.schema"

const processingCostRouter = Router()

processingCostRouter.use(authenticate)

processingCostRouter.get("/", authorize("processingCosts:view"), validate(processingCostQuerySchema, "query"), processingCostController.index)
processingCostRouter.get(
    "/:id",
    authorize("processingCosts:view"),
    validate(processingCostIdParamSchema, "params"),
    processingCostController.show
)
processingCostRouter.post("/", authorize("processingCosts:create"), validate(createProcessingCostSchema), processingCostController.store)
processingCostRouter.put(
    "/:id",
    authorize("processingCosts:edit"),
    validate(processingCostIdParamSchema, "params"),
    validate(updateProcessingCostSchema),
    processingCostController.update
)
processingCostRouter.delete(
    "/:id",
    authorize("processingCosts:delete"),
    validate(processingCostIdParamSchema, "params"),
    processingCostController.destroy
)

export default processingCostRouter
