import { Router } from "express"
import multer from "multer"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { productPackagingImportController } from "../controllers/productPackagingImport.controller"

const productPackagingImportRouter = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1 } })
productPackagingImportRouter.use(authenticate, authorize("products:edit"))
productPackagingImportRouter.get("/bulk-import/template", productPackagingImportController.downloadTemplate)
productPackagingImportRouter.post("/bulk-import/preview", upload.single("file"), productPackagingImportController.preview)
productPackagingImportRouter.post("/bulk-import/confirm", upload.single("file"), productPackagingImportController.confirm)

export default productPackagingImportRouter
