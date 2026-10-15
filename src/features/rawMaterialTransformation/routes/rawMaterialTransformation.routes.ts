import { Router } from "express"
import { rawMaterialTransformationController as controller } from "../controllers/rawMaterialTransformation.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import {
    previewRawMaterialTransformationSchema,
    rawMaterialTransformationIdParamSchema,
    rawMaterialTransformationQuerySchema,
    saveRawMaterialTransformationSchema,
} from "../schemas/rawMaterialTransformation.schema"

const rawMaterialTransformationRouter = Router()

rawMaterialTransformationRouter.use(authenticate)

rawMaterialTransformationRouter.get("/", authorize("rawMaterialTransformations:view"), validate(rawMaterialTransformationQuerySchema, "query"), controller.index)
// Antes de "/:id" para que "sources" no se interprete como id.
rawMaterialTransformationRouter.get("/sources", authorize("rawMaterialTransformations:view"), controller.sources)
// Solo calcula (nunca escribe); se permite a quien puede ver el módulo.
rawMaterialTransformationRouter.post("/preview", authorize("rawMaterialTransformations:view"), validate(previewRawMaterialTransformationSchema), controller.preview)
rawMaterialTransformationRouter.get("/:id", authorize("rawMaterialTransformations:view"), validate(rawMaterialTransformationIdParamSchema, "params"), controller.show)
rawMaterialTransformationRouter.post("/", authorize("rawMaterialTransformations:create"), validate(saveRawMaterialTransformationSchema), controller.store)
rawMaterialTransformationRouter.put(
    "/:id",
    authorize("rawMaterialTransformations:edit"),
    validate(rawMaterialTransformationIdParamSchema, "params"),
    validate(saveRawMaterialTransformationSchema),
    controller.update
)
rawMaterialTransformationRouter.post(
    "/:id/recalculate",
    authorize("rawMaterialTransformations:edit"),
    validate(rawMaterialTransformationIdParamSchema, "params"),
    controller.recalculate
)

export default rawMaterialTransformationRouter
