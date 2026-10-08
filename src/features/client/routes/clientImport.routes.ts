import { Router } from "express"
import multer from "multer"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { clientImportController } from "../controllers/clientImport.controller"

const clientImportRouter = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })
clientImportRouter.use(authenticate)
clientImportRouter.get("/bulk-import/template", authorize("clients:create"), clientImportController.downloadTemplate)
clientImportRouter.post("/bulk-import", authorize("clients:create"), upload.single("file"), clientImportController.bulkImport)

export default clientImportRouter
