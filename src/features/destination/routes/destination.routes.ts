import { Router } from "express"
import { destinationController } from "../controllers/destination.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { createDestinationSchema, updateDestinationSchema, destinationIdParamSchema, destinationQuerySchema } from "../schemas/destination.schema"

const destinationRouter = Router()

destinationRouter.use(authenticate)

destinationRouter.get("/", authorize("destinations:view"), validate(destinationQuerySchema, "query"), destinationController.index)
destinationRouter.get("/:id", authorize("destinations:view"), validate(destinationIdParamSchema, "params"), destinationController.show)
destinationRouter.post("/", authorize("destinations:create"), validate(createDestinationSchema), destinationController.store)
destinationRouter.put("/:id", authorize("destinations:edit"), validate(destinationIdParamSchema, "params"), validate(updateDestinationSchema), destinationController.update)
destinationRouter.delete("/:id", authorize("destinations:delete"), validate(destinationIdParamSchema, "params"), destinationController.destroy)

export default destinationRouter
