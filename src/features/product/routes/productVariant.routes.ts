import { Router } from "express"
import multer from "multer"
import { productVariantController } from "../controllers/productVariant.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import {
    createProductVariantSchema,
    updateProductVariantSchema,
    productVariantIdParamSchema,
    productVariantSkuCodeParamSchema,
} from "../schemas/productVariant.schema"

const productVariantRouter = Router()

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
})

productVariantRouter.use(authenticate)

productVariantRouter.get("/", authorize("products:view"), productVariantController.index)

productVariantRouter.get("/bulk-import/template", authorize("products:edit"), productVariantController.downloadTemplate)
productVariantRouter.post("/bulk-import", authorize("products:edit"), upload.single("file"), productVariantController.bulkImport)
productVariantRouter.get(
    "/lookup/:skuCode",
    authorize("products:view"),
    validate(productVariantSkuCodeParamSchema, "params"),
    productVariantController.lookupBySkuCode
)

productVariantRouter.get("/:id", authorize("products:view"), validate(productVariantIdParamSchema, "params"), productVariantController.show)
productVariantRouter.post("/", authorize("products:edit"), validate(createProductVariantSchema), productVariantController.store)
productVariantRouter.put("/:id", authorize("products:edit"), validate(productVariantIdParamSchema, "params"), validate(updateProductVariantSchema), productVariantController.update)
productVariantRouter.delete("/:id", authorize("products:edit"), validate(productVariantIdParamSchema, "params"), productVariantController.destroy)

export default productVariantRouter
