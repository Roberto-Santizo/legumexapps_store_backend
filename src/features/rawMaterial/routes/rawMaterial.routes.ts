import { Router } from "express"
import multer from "multer"
import { rawMaterialController } from "../controllers/rawMaterial.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { createRawMaterialSchema, updateRawMaterialSchema, rawMaterialIdParamSchema, rawMaterialQuerySchema } from "../schemas/rawMaterial.schema"

const rawMaterialRouter = Router()

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
})

rawMaterialRouter.use(authenticate)

rawMaterialRouter.get("/", authorize("rawMaterials:view"), validate(rawMaterialQuerySchema, "query"), rawMaterialController.index)

rawMaterialRouter.get("/bulk-import/template", authorize("rawMaterials:create"), rawMaterialController.downloadTemplate)
rawMaterialRouter.post("/bulk-import", authorize("rawMaterials:create"), upload.single("file"), rawMaterialController.bulkImport)

rawMaterialRouter.get("/:id", authorize("rawMaterials:view"), validate(rawMaterialIdParamSchema, "params"), rawMaterialController.show)
rawMaterialRouter.post("/", authorize("rawMaterials:create"), validate(createRawMaterialSchema), rawMaterialController.store)
rawMaterialRouter.put("/:id", authorize("rawMaterials:edit"), validate(rawMaterialIdParamSchema, "params"), validate(updateRawMaterialSchema), rawMaterialController.update)
rawMaterialRouter.delete("/:id", authorize("rawMaterials:delete"), validate(rawMaterialIdParamSchema, "params"), rawMaterialController.destroy)

export default rawMaterialRouter
