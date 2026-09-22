import { Router } from "express"
import { clientController } from "../controllers/client.controller"
import { createClientSchema, updateClientSchema, updateClientStatusSchema, clientIdParamSchema, clientQuerySchema } from "../schemas/client.schema"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"

const clientRouter = Router()

clientRouter.use(authenticate)

clientRouter.get("/", authorize("clients:view"), validate(clientQuerySchema, "query"), clientController.index)
clientRouter.get("/:id", authorize("clients:view"), validate(clientIdParamSchema, "params"), clientController.show)
clientRouter.post("/", authorize("clients:create"), validate(createClientSchema), clientController.store)
clientRouter.patch(
    "/:id",
    authorize("clients:edit"),
    validate(clientIdParamSchema, "params"),
    validate(updateClientSchema),
    clientController.update
)
clientRouter.patch(
    "/:id/status",
    authorize("clients:edit"),
    validate(clientIdParamSchema, "params"),
    validate(updateClientStatusSchema),
    clientController.updateStatus
)

export default clientRouter
