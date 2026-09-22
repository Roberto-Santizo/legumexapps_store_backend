import { Router } from "express"
import { salespersonLoginController } from "../controllers/salespersonLogin.controller"
import { salespersonLoginSchema } from "../schemas/salespersonLogin.schema"
import { validate } from "../../../shared/middlewares/validate"

const salespersonLoginRouter = Router()

salespersonLoginRouter.post("/", validate(salespersonLoginSchema), salespersonLoginController.login)

export default salespersonLoginRouter
