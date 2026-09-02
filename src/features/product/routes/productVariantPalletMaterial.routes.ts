import { Router } from "express"
import { productVariantPalletMaterialController } from "../controllers/productVariantPalletMaterial.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import {
    createProductVariantPalletMaterialSchema,
    updateProductVariantPalletMaterialSchema,
    productVariantPalletMaterialIdParamSchema
} from "../schemas/productVariantPalletMaterial.schema"

const productVariantPalletMaterialRouter = Router()

productVariantPalletMaterialRouter.use(authenticate)

productVariantPalletMaterialRouter.get("/", authorize("products:view"), productVariantPalletMaterialController.index)
productVariantPalletMaterialRouter.get(
    "/:id",
    authorize("products:view"),
    validate(productVariantPalletMaterialIdParamSchema, "params"),
    productVariantPalletMaterialController.show
)
productVariantPalletMaterialRouter.post(
    "/",
    authorize("products:edit"),
    validate(createProductVariantPalletMaterialSchema),
    productVariantPalletMaterialController.store
)
productVariantPalletMaterialRouter.put(
    "/:id",
    authorize("products:edit"),
    validate(productVariantPalletMaterialIdParamSchema, "params"),
    validate(updateProductVariantPalletMaterialSchema),
    productVariantPalletMaterialController.update
)
productVariantPalletMaterialRouter.delete(
    "/:id",
    authorize("products:edit"),
    validate(productVariantPalletMaterialIdParamSchema, "params"),
    productVariantPalletMaterialController.destroy
)

export default productVariantPalletMaterialRouter
