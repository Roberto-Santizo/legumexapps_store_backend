import { Router } from "express"
import multer from "multer"
import { productRawMaterialController } from "../controllers/productRawMaterial.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { createProductRawMaterialSchema, updateProductRawMaterialSchema, productRawMaterialIdParamSchema } from "../schemas/productRawMaterial.schema"

const productRawMaterialRouter = Router()

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
})

productRawMaterialRouter.use(authenticate)

productRawMaterialRouter.get("/", authorize("products:view"), productRawMaterialController.index)
// Carga masiva de Recetas (2026-09-25) -- ANTES de /:id. Mismo permiso que el CRUD de filas de
// receta (products:edit).
productRawMaterialRouter.get("/bulk-import/template", authorize("products:edit"), productRawMaterialController.downloadTemplate)
productRawMaterialRouter.post("/bulk-import", authorize("products:edit"), upload.single("file"), productRawMaterialController.bulkImport)

productRawMaterialRouter.get("/:id", authorize("products:view"), validate(productRawMaterialIdParamSchema, "params"), productRawMaterialController.show)
productRawMaterialRouter.post("/", authorize("products:edit"), validate(createProductRawMaterialSchema), productRawMaterialController.store)
productRawMaterialRouter.put("/:id", authorize("products:edit"), validate(productRawMaterialIdParamSchema, "params"), validate(updateProductRawMaterialSchema), productRawMaterialController.update)
productRawMaterialRouter.delete("/:id", authorize("products:edit"), validate(productRawMaterialIdParamSchema, "params"), productRawMaterialController.destroy)

export default productRawMaterialRouter
