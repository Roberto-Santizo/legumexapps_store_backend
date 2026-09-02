import { Router } from "express"
import multer from "multer"
import { packagingController } from "../controllers/packaging.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { createPackagingSchema, updatePackagingSchema, packagingIdParamSchema, packagingQuerySchema } from "../schemas/packaging.schema"

const packagingRouter = Router()

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB -- de sobra para un catálogo de empaques
})

packagingRouter.use(authenticate)

packagingRouter.get("/", authorize("packagings:view"), validate(packagingQuerySchema, "query"), packagingController.index)

packagingRouter.get("/bulk-import/template", authorize("packagings:create"), packagingController.downloadTemplate)
packagingRouter.post("/bulk-import", authorize("packagings:create"), upload.single("file"), packagingController.bulkImport)

packagingRouter.get("/:id", authorize("packagings:view"), validate(packagingIdParamSchema, "params"), packagingController.show)
packagingRouter.post("/", authorize("packagings:create"), validate(createPackagingSchema), packagingController.store)
packagingRouter.put("/:id", authorize("packagings:edit"), validate(packagingIdParamSchema, "params"), validate(updatePackagingSchema), packagingController.update)
packagingRouter.delete("/:id", authorize("packagings:delete"), validate(packagingIdParamSchema, "params"), packagingController.destroy)

export default packagingRouter
