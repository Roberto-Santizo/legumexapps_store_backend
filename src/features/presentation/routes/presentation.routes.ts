import { Router } from "express"
import multer from "multer"
import { presentationController } from "../controllers/presentation.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { createPresentationSchema, updatePresentationSchema, presentationIdParamSchema, presentationQuerySchema } from "../schemas/presentation.schema"

const presentationRouter = Router()

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB -- de sobra para un catálogo de presentaciones
})

presentationRouter.use(authenticate)

presentationRouter.get("/", authorize("presentations:view"), validate(presentationQuerySchema, "query"), presentationController.index)

// Declaradas ANTES de "/:id" -- si no, Express interpretaría "bulk-import" como el :id.
presentationRouter.get("/bulk-import/template", authorize("presentations:create"), presentationController.downloadTemplate)
presentationRouter.post("/bulk-import", authorize("presentations:create"), upload.single("file"), presentationController.bulkImport)

presentationRouter.get("/:id", authorize("presentations:view"), validate(presentationIdParamSchema, "params"), presentationController.show)
presentationRouter.post("/", authorize("presentations:create"), validate(createPresentationSchema), presentationController.store)
presentationRouter.put("/:id", authorize("presentations:edit"), validate(presentationIdParamSchema, "params"), validate(updatePresentationSchema), presentationController.update)
presentationRouter.delete("/:id", authorize("presentations:delete"), validate(presentationIdParamSchema, "params"), presentationController.destroy)

export default presentationRouter
