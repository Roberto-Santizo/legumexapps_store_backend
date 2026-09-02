import { Router } from "express"
import { customerLoginController } from "../controllers/customerLogin.controller"
import { customerLoginSchema } from "../schemas/customerLogin.schema"
import { validate } from "../../../shared/middlewares/validate"

const customerLoginRouter = Router()

customerLoginRouter.post("/", validate(customerLoginSchema), customerLoginController.login)

export default customerLoginRouter
