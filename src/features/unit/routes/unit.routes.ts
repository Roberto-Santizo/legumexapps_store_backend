import { Router } from "express"
import { unitController } from "../controllers/unit.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { createUnitSchema, updateUnitSchema, unitIdParamSchema, unitQuerySchema } from "../schemas/unit.schema"

const unitRouter = Router()

unitRouter.use(authenticate)

unitRouter.get("/", authorize("units:view"), validate(unitQuerySchema, "query"), unitController.index)
unitRouter.get("/:id", authorize("units:view"), validate(unitIdParamSchema, "params"), unitController.show)
unitRouter.post("/", authorize("units:create"), validate(createUnitSchema), unitController.store)
unitRouter.put("/:id", authorize("units:edit"), validate(unitIdParamSchema, "params"), validate(updateUnitSchema), unitController.update)
unitRouter.delete("/:id", authorize("units:delete"), validate(unitIdParamSchema, "params"), unitController.destroy)

export default unitRouter
