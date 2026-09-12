import { Router } from "express"
import { productVariantUnitMaterialController } from "../controllers/productVariantUnitMaterial.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import {
    createProductVariantUnitMaterialSchema,
    updateProductVariantUnitMaterialSchema,
    productVariantUnitMaterialIdParamSchema
} from "../schemas/productVariantUnitMaterial.schema"

const productVariantUnitMaterialRouter = Router()

productVariantUnitMaterialRouter.use(authenticate)

productVariantUnitMaterialRouter.get("/", authorize("products:view"), productVariantUnitMaterialController.index)
productVariantUnitMaterialRouter.get(
    "/:id",
    authorize("products:view"),
    validate(productVariantUnitMaterialIdParamSchema, "params"),
    productVariantUnitMaterialController.show
)
productVariantUnitMaterialRouter.post(
    "/",
    authorize("products:edit"),
    validate(createProductVariantUnitMaterialSchema),
    productVariantUnitMaterialController.store
)
productVariantUnitMaterialRouter.put(
    "/:id",
    authorize("products:edit"),
    validate(productVariantUnitMaterialIdParamSchema, "params"),
    validate(updateProductVariantUnitMaterialSchema),
    productVariantUnitMaterialController.update
)
productVariantUnitMaterialRouter.delete(
    "/:id",
    authorize("products:edit"),
    validate(productVariantUnitMaterialIdParamSchema, "params"),
    productVariantUnitMaterialController.destroy
)

export default productVariantUnitMaterialRouter
