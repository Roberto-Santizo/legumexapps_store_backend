import { Router } from "express"
import { productController } from "../controllers/Product.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { createProductSchema, updateProductSchema, updateProductStatusSchema, productIdParamSchema, productQuerySchema } from "../schemas/product.schema"

const productRouter = Router()

productRouter.use(authenticate)

productRouter.get("/", authorize("products:view"), validate(productQuerySchema, "query"), productController.index)
productRouter.get("/:id", authorize("products:view"), validate(productIdParamSchema, "params"), productController.show)
productRouter.post("/", authorize("products:create"), validate(createProductSchema), productController.store)
productRouter.put("/:id", authorize("products:edit"), validate(productIdParamSchema, "params"), validate(updateProductSchema), productController.update)
productRouter.patch("/:id/status", authorize("products:edit"), validate(productIdParamSchema, "params"), validate(updateProductStatusSchema), productController.updateStatus)
productRouter.delete("/:id", authorize("products:delete"), validate(productIdParamSchema, "params"), productController.destroy)

export default productRouter
