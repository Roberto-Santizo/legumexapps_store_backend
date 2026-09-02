import { Router } from "express";
import { rolePermissionController } from "../controllers/rolePermission.controller";
import { roleIdParamSchema, syncRolePermissionsSchema } from "../schemas/rolePermission.schema";
import { validate } from "../../../../shared/middlewares/validate";
import { authenticate } from "../../../../shared/middlewares/authenticate";
import { authorize } from "../../../../shared/middlewares/authorize";

const rolePermissionRouter = Router({ mergeParams: true })

rolePermissionRouter.use(authenticate)

rolePermissionRouter.get(
    "/:roleId/permissions",
    authorize("roles:view"),
    validate(roleIdParamSchema, "params"),
    rolePermissionController.index
)
rolePermissionRouter.put(
    "/:roleId/permissions",
    authorize("roles:edit"),
    validate(roleIdParamSchema, "params"),
    validate(syncRolePermissionsSchema),
    rolePermissionController.sync
)

export default rolePermissionRouter
