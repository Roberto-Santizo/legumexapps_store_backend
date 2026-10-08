import { Router } from "express"
import { productVariantIntermediateMaterialController } from "../controllers/productVariantIntermediateMaterial.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import {
    createProductVariantIntermediateMaterialSchema,
    updateProductVariantIntermediateMaterialSchema,
    productVariantIntermediateMaterialIdParamSchema
} from "../schemas/productVariantIntermediateMaterial.schema"

const productVariantIntermediateMaterialRouter = Router()

productVariantIntermediateMaterialRouter.use(authenticate)

productVariantIntermediateMaterialRouter.get("/", authorize("products:view"), productVariantIntermediateMaterialController.index)
productVariantIntermediateMaterialRouter.get(
    "/:id",
    authorize("products:view"),
    validate(productVariantIntermediateMaterialIdParamSchema, "params"),
    productVariantIntermediateMaterialController.show
)
productVariantIntermediateMaterialRouter.post(
    "/",
    authorize("products:edit"),
    validate(createProductVariantIntermediateMaterialSchema),
    productVariantIntermediateMaterialController.store
)
productVariantIntermediateMaterialRouter.put(
    "/:id",
    authorize("products:edit"),
    validate(productVariantIntermediateMaterialIdParamSchema, "params"),
    validate(updateProductVariantIntermediateMaterialSchema),
    productVariantIntermediateMaterialController.update
)
productVariantIntermediateMaterialRouter.delete(
    "/:id",
    authorize("products:edit"),
    validate(productVariantIntermediateMaterialIdParamSchema, "params"),
    productVariantIntermediateMaterialController.destroy
)

export default productVariantIntermediateMaterialRouter
