import { Router } from "express"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { validate } from "../../../shared/middlewares/validate"
import { juiceConfigController as controller } from "../controllers/juice.controller"
import { juiceStatusSchema } from "../schemas/juice.schema"
import * as schemas from "../schemas/juiceConfig.schema"

const router = Router()
router.use(authenticate, authorize("juiceConfig:edit"))

router.get("/constants", controller.get)
router.post("/constants", validate(schemas.createJuiceCostConstantsSchema), controller.create)
router.patch("/constants", validate(schemas.updateJuiceCostConstantsSchema), controller.update)
router.get("/client-overrides", controller.listOverrides)
router.post("/client-overrides", validate(schemas.createJuiceClientConstantOverrideSchema), controller.createOverride)
router.get("/client-overrides/:clientId", validate(schemas.juiceClientParamSchema, "params"), controller.getOverride)
router.patch("/client-overrides/:clientId", validate(schemas.juiceClientParamSchema, "params"), validate(schemas.updateJuiceClientConstantOverrideSchema), controller.updateOverride)
router.patch("/client-overrides/:clientId/status", validate(schemas.juiceClientParamSchema, "params"), validate(juiceStatusSchema), controller.overrideStatus)
router.delete("/client-overrides/:clientId", validate(schemas.juiceClientParamSchema, "params"), controller.removeOverride)
router.get("/resolved/:clientId", validate(schemas.juiceClientParamSchema, "params"), controller.resolve)

export default router
