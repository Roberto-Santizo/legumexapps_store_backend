import { Router } from "express";
import { permissionController } from "../controllers/permission.controller";
import { createPermissionSchema, permissionIdParamSchema, updatePermissionSchema } from "../schemas/permission.schema";
import { validate } from "../../../../shared/middlewares/validate";
import { authenticate } from "../../../../shared/middlewares/authenticate";
import { authorize } from "../../../../shared/middlewares/authorize";

const permissionRouter = Router()

permissionRouter.use(authenticate)

permissionRouter.get("/", authorize("permissions:view"), permissionController.index)
permissionRouter.get("/:id", authorize("permissions:view"), validate(permissionIdParamSchema, "params"), permissionController.show)
permissionRouter.post("/", authorize("permissions:create"), validate(createPermissionSchema), permissionController.store)
permissionRouter.patch("/:id", authorize("permissions:edit"), validate(permissionIdParamSchema, "params"), validate(updatePermissionSchema), permissionController.update)
permissionRouter.delete("/:id", authorize("permissions:delete"), validate(permissionIdParamSchema, "params"), permissionController.destroy)

export default permissionRouter
