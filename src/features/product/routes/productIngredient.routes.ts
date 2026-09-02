import { Router } from "express"
import { productIngredientController } from "../controllers/productIngredient.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { createProductIngredientSchema, updateProductIngredientSchema, productIngredientIdParamSchema } from "../schemas/productIngredient.schema"

const productIngredientRouter = Router()

productIngredientRouter.use(authenticate)

productIngredientRouter.get("/", authorize("products:view"), productIngredientController.index)
productIngredientRouter.get("/:id", authorize("products:view"), validate(productIngredientIdParamSchema, "params"), productIngredientController.show)
productIngredientRouter.post("/", authorize("products:edit"), validate(createProductIngredientSchema), productIngredientController.store)
productIngredientRouter.put("/:id", authorize("products:edit"), validate(productIngredientIdParamSchema, "params"), validate(updateProductIngredientSchema), productIngredientController.update)
productIngredientRouter.delete("/:id", authorize("products:edit"), validate(productIngredientIdParamSchema, "params"), productIngredientController.destroy)

export default productIngredientRouter
