import { Router } from "express"
import { siteImageController } from "../controllers/siteImage.controller"

// Público, sin auth -- la landing lee de acá para saber si algún slot tiene imagen subida desde
// el admin (ver useSiteImages.ts en el frontend). Slots sin fila simplemente no vienen en la
// respuesta; el frontend cae a su imagen bundled por defecto.
const siteImageRouter = Router()

siteImageRouter.get("/", siteImageController.publicIndex)

export default siteImageRouter
