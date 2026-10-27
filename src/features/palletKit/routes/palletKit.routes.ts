import { Router } from "express"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { validate } from "../../../shared/middlewares/validate"
import { palletKitController as controller } from "../controllers/palletKit.controller"
import { palletKitMaterialSchema, palletKitPackagingIdParamSchema } from "../schemas/palletKit.schema"
const router = Router()
router.use(authenticate)
router.get("/", authorize("palletKit:view"), controller.get)
router.get("/candidates", authorize("palletKit:edit"), controller.candidates)
router.post("/materials", authorize("palletKit:edit"), validate(palletKitMaterialSchema), controller.add)
router.delete("/materials/:packagingId", authorize("palletKit:edit"), validate(palletKitPackagingIdParamSchema, "params"), controller.remove)
export default router
