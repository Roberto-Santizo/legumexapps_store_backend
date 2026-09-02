import { Router } from "express";
import { userController } from "../controllers/user.controllers";
import { createUserSchema, userIdParamSchema, updateUserSchema, updateUserStatusSchema, userQuerySchema } from "../schemas/user.schema";
import { validate } from "../../../../shared/middlewares/validate";
import { authenticate } from "../../../../shared/middlewares/authenticate";
import { authorize } from "../../../../shared/middlewares/authorize";

const userRouter = Router()

userRouter.use(authenticate)

userRouter.get("/", authorize("users:view"), validate(userQuerySchema, "query"), userController.index)
userRouter.get("/:id", authorize("users:view"), validate(userIdParamSchema, "params"), userController.show)
userRouter.post("/", authorize("users:create"), validate(createUserSchema), userController.store)
userRouter.patch("/:id", authorize("users:edit"), validate(userIdParamSchema, "params"), validate(updateUserSchema), userController.update)
userRouter.patch("/:id/status", authorize("users:edit"), validate(userIdParamSchema, "params"), validate(updateUserStatusSchema), userController.updateStatus)
userRouter.delete("/:id", authorize("users:delete"), validate(userIdParamSchema, "params"), userController.destroy)

export default userRouter
