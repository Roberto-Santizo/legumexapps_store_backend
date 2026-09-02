import { Router } from "express";
import { authController } from "../controllers/login.controller";
import { loginSchema } from "../schemas/login.schema";
import { validate } from "../../../../shared/middlewares/validate";

const loginRouter = Router()

loginRouter.post("/", validate(loginSchema), authController.login)

export default loginRouter
