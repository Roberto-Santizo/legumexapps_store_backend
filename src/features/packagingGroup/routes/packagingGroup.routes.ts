import { Router } from "express"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { validate } from "../../../shared/middlewares/validate"
import { packagingGroupController as controller } from "../controllers/packagingGroup.controller"
import { packagingGroupIdSchema, packagingGroupSchema, packagingGroupStatusSchema } from "../schemas/packagingGroup.schema"
const router = Router()
router.use(authenticate)
// Product editors need to read the selector without acquiring catalog administration rights.
router.get("/options", authorize("products:edit"), controller.list)
router.get("/", authorize("packagingGroups:view"), controller.list)
router.get("/:id", authorize("packagingGroups:view"), validate(packagingGroupIdSchema, "params"), controller.get)
router.post("/", authorize("packagingGroups:create"), validate(packagingGroupSchema), controller.create)
router.patch("/:id", authorize("packagingGroups:edit"), validate(packagingGroupIdSchema, "params"), validate(packagingGroupSchema), controller.update)
router.patch("/:id/status", authorize("packagingGroups:edit"), validate(packagingGroupIdSchema, "params"), validate(packagingGroupStatusSchema), controller.status)
export default router
