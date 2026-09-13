import { Router } from "express"
import { leadController } from "../controllers/lead.controller"
import { validate } from "../../../shared/middlewares/validate"
import { publicCreateLeadSchema } from "../schemas/lead.schema"

// Público, sin auth -- es el formulario de contacto de la landing (ver
// feature/home/component/leadCaptureForm.component.tsx en el frontend).
const leadRouter = Router()

leadRouter.post("/", validate(publicCreateLeadSchema), leadController.store)

export default leadRouter
