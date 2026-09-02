import { Router } from "express";
import { roleController } from "../controllers/role.controllers";
import { createRoleSchema,roleIdParamSchema,updateRoleSchema,roleQuerySchema, } from "../schemas/role.schema";
import {validate} from "../../../../shared/middlewares/validate"
import { authenticate } from "../../../../shared/middlewares/authenticate"
import { authorize } from "../../../../shared/middlewares/authorize"

const roleRouter = Router()

roleRouter.use(authenticate)

roleRouter.get("/", authorize("roles:view"), validate(roleQuerySchema, "query"), roleController.index)
roleRouter.get("/:id", authorize("roles:view"), validate(roleIdParamSchema, "params"), roleController.show)
roleRouter.post("/", authorize("roles:create"), validate(createRoleSchema), roleController.store)
roleRouter.patch("/:id", authorize("roles:edit"), validate(roleIdParamSchema, "params"), validate(updateRoleSchema), roleController.update)
roleRouter.delete("/:id", authorize("roles:delete"), validate(roleIdParamSchema, "params"), roleController.destroy)

export default roleRouter
