import { Router } from "express"
import multer from "multer"
import { ingredientController } from "../controllers/ingredient.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { createIngredientSchema, updateIngredientSchema, ingredientIdParamSchema, ingredientQuerySchema } from "../schemas/ingredient.schema"

const ingredientRouter = Router()

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
})

ingredientRouter.use(authenticate)

ingredientRouter.get("/", authorize("ingredients:view"), validate(ingredientQuerySchema, "query"), ingredientController.index)

ingredientRouter.get("/bulk-import/template", authorize("ingredients:create"), ingredientController.downloadTemplate)
ingredientRouter.post("/bulk-import", authorize("ingredients:create"), upload.single("file"), ingredientController.bulkImport)

ingredientRouter.get("/:id", authorize("ingredients:view"), validate(ingredientIdParamSchema, "params"), ingredientController.show)
ingredientRouter.post("/", authorize("ingredients:create"), validate(createIngredientSchema), ingredientController.store)
ingredientRouter.put("/:id", authorize("ingredients:edit"), validate(ingredientIdParamSchema, "params"), validate(updateIngredientSchema), ingredientController.update)
ingredientRouter.delete("/:id", authorize("ingredients:delete"), validate(ingredientIdParamSchema, "params"), ingredientController.destroy)

export default ingredientRouter
