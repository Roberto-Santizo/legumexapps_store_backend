import { Router } from "express"
import { productTypeController } from "../controllers/ProductType.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { createProductTypeSchema, updateProductTypeSchema, productTypeIdParamSchema, productTypeQuerySchema } from "../schemas/productType.schema"

const productTypeRouter = Router()

productTypeRouter.use(authenticate)

productTypeRouter.get("/", authorize("productTypes:view"), validate(productTypeQuerySchema, "query"), productTypeController.index)
productTypeRouter.get("/:id", authorize("productTypes:view"), validate(productTypeIdParamSchema, "params"), productTypeController.show)
productTypeRouter.post("/", authorize("productTypes:create"), validate(createProductTypeSchema), productTypeController.store)
productTypeRouter.put("/:id", authorize("productTypes:edit"), validate(productTypeIdParamSchema, "params"), validate(updateProductTypeSchema), productTypeController.update)
productTypeRouter.delete("/:id", authorize("productTypes:delete"), validate(productTypeIdParamSchema, "params"), productTypeController.destroy)

export default productTypeRouter
