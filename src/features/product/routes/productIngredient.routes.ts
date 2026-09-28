import { Router } from "express"
import multer from "multer"
import { productIngredientController } from "../controllers/productIngredient.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { createProductIngredientSchema, updateProductIngredientSchema, productIngredientIdParamSchema } from "../schemas/productIngredient.schema"

const productIngredientRouter = Router()

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
})

productIngredientRouter.use(authenticate)

productIngredientRouter.get("/", authorize("products:view"), productIngredientController.index)
// Carga masiva de ingredientes por producto (paso 3 del pipeline) -- ANTES de /:id. Mismo permiso
// que el CRUD de filas (products:edit).
productIngredientRouter.get("/bulk-import/template", authorize("products:edit"), productIngredientController.downloadTemplate)
productIngredientRouter.post("/bulk-import", authorize("products:edit"), upload.single("file"), productIngredientController.bulkImport)

productIngredientRouter.get("/:id", authorize("products:view"), validate(productIngredientIdParamSchema, "params"), productIngredientController.show)
productIngredientRouter.post("/", authorize("products:edit"), validate(createProductIngredientSchema), productIngredientController.store)
productIngredientRouter.put("/:id", authorize("products:edit"), validate(productIngredientIdParamSchema, "params"), validate(updateProductIngredientSchema), productIngredientController.update)
productIngredientRouter.delete("/:id", authorize("products:edit"), validate(productIngredientIdParamSchema, "params"), productIngredientController.destroy)

export default productIngredientRouter
