import { Router } from "express"
import { productVariantController } from "../controllers/productVariant.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { createProductVariantSchema, updateProductVariantSchema, productVariantIdParamSchema } from "../schemas/productVariant.schema"

const productVariantRouter = Router()

productVariantRouter.use(authenticate)

productVariantRouter.get("/", authorize("products:view"), productVariantController.index)
productVariantRouter.get("/:id", authorize("products:view"), validate(productVariantIdParamSchema, "params"), productVariantController.show)
productVariantRouter.post("/", authorize("products:edit"), validate(createProductVariantSchema), productVariantController.store)
productVariantRouter.put("/:id", authorize("products:edit"), validate(productVariantIdParamSchema, "params"), validate(updateProductVariantSchema), productVariantController.update)
productVariantRouter.delete("/:id", authorize("products:edit"), validate(productVariantIdParamSchema, "params"), productVariantController.destroy)

export default productVariantRouter
