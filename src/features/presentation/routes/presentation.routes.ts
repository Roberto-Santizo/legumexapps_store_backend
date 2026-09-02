import { Router } from "express"
import { presentationController } from "../controllers/presentation.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { createPresentationSchema, updatePresentationSchema, presentationIdParamSchema, presentationQuerySchema } from "../schemas/presentation.schema"

const presentationRouter = Router()

presentationRouter.use(authenticate)

presentationRouter.get("/", authorize("presentations:view"), validate(presentationQuerySchema, "query"), presentationController.index)
presentationRouter.get("/:id", authorize("presentations:view"), validate(presentationIdParamSchema, "params"), presentationController.show)
presentationRouter.post("/", authorize("presentations:create"), validate(createPresentationSchema), presentationController.store)
presentationRouter.put("/:id", authorize("presentations:edit"), validate(presentationIdParamSchema, "params"), validate(updatePresentationSchema), presentationController.update)
presentationRouter.delete("/:id", authorize("presentations:delete"), validate(presentationIdParamSchema, "params"), presentationController.destroy)

export default presentationRouter
