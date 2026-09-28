import { Router } from "express"
import multer from "multer"
import { productController } from "../controllers/Product.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { createProductSchema, updateProductSchema, updateProductStatusSchema, productIdParamSchema, productQuerySchema } from "../schemas/product.schema"

const productRouter = Router()

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
})

productRouter.use(authenticate)

productRouter.get("/", authorize("products:view"), validate(productQuerySchema, "query"), productController.index)
// Carga masiva de Productos base -- ANTES de /:id para que "bulk-import" no se lea
// como un id. Mismo permiso que el formulario de crear producto (products:create).
productRouter.get("/bulk-import/template", authorize("products:create"), productController.downloadTemplate)
productRouter.post("/bulk-import", authorize("products:create"), upload.single("file"), productController.bulkImport)

productRouter.get("/:id", authorize("products:view"), validate(productIdParamSchema, "params"), productController.show)
productRouter.post("/", authorize("products:create"), validate(createProductSchema), productController.store)
productRouter.put("/:id", authorize("products:edit"), validate(productIdParamSchema, "params"), validate(updateProductSchema), productController.update)
productRouter.patch("/:id/status", authorize("products:edit"), validate(productIdParamSchema, "params"), validate(updateProductStatusSchema), productController.updateStatus)
productRouter.delete("/:id", authorize("products:delete"), validate(productIdParamSchema, "params"), productController.destroy)

export default productRouter
