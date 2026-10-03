import { Router } from "express"
import multer from "multer"
import { ZodType } from "zod"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { validate } from "../../../shared/middlewares/validate"
import { juiceControllers } from "../controllers/juice.controller"
import * as schemas from "../schemas/juice.schema"
import { juiceImportController } from "../controllers/juiceImport.controller"

const router = Router()
router.use(authenticate)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })
router.get("/bulk-import/template", authorize("juices:create"), juiceImportController.template)
router.post("/bulk-import", authorize("juices:create"), upload.single("file"), juiceImportController.import)

function mount(path: string, controller: typeof juiceControllers.juices, create: ZodType, update: ZodType) {
    router.get(path, authorize("juices:view"), validate(schemas.juiceListQuerySchema, "query"), controller.list)
    router.post(path, authorize("juices:create"), validate(create), controller.create)
    const item = `${path === "/" ? "" : path}/:id`
    router.get(item, authorize("juices:view"), validate(schemas.juiceIdParamSchema, "params"), controller.get)
    router.patch(item, authorize("juices:edit"), validate(schemas.juiceIdParamSchema, "params"), validate(update), controller.update)
    router.patch(`${item}/status`, authorize("juices:edit"), validate(schemas.juiceIdParamSchema, "params"), validate(schemas.juiceStatusSchema), controller.status)
    router.delete(item, authorize("juices:delete"), validate(schemas.juiceIdParamSchema, "params"), controller.remove)
}

// Literal subresources precede /:id; do not let "raw-materials" be interpreted as a juice id.
mount("/raw-materials", juiceControllers.rawMaterials, schemas.createJuiceRawMaterialSchema, schemas.updateJuiceRawMaterialSchema)
mount("/presentations", juiceControllers.presentations, schemas.createJuicePresentationSchema, schemas.updateJuicePresentationSchema)
mount("/mix", juiceControllers.mix, schemas.createJuiceMixSchema, schemas.updateJuiceMixSchema)
mount("/spice-materials", juiceControllers.spiceMaterials, schemas.createJuiceSpiceMaterialSchema, schemas.updateJuiceSpiceMaterialSchema)
mount("/spices", juiceControllers.spices, schemas.createJuiceSpiceSchema, schemas.updateJuiceSpiceSchema)
mount("/", juiceControllers.juices, schemas.createJuiceSchema, schemas.updateJuiceSchema)

export default router
