import { Router } from "express"
import multer from "multer"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { validate } from "../../../shared/middlewares/validate"
import { laborTemplateController as controller } from "../controllers/laborTemplate.controller"
import { laborImportController } from "../controllers/laborImport.controller"
import { laborCalculationSchema, laborLineCodeSchema, laborRevisionParamSchema, laborTemplateIdSchema, laborTemplateQuerySchema, saveLaborLineSchema, saveLaborTemplateSchema } from "../schemas/laborTemplate.schema"

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1 } })
router.use(authenticate)
router.get("/bulk-import/template", authorize("laborTemplates:create"), laborImportController.template)
router.post("/bulk-import/preview", authorize("laborTemplates:create"), upload.single("file"), laborImportController.preview)
router.post("/bulk-import/confirm", authorize("laborTemplates:create"), upload.single("file"), laborImportController.confirm)
router.get("/reference", authorize("laborTemplates:view"), controller.reference)
router.get("/lines", authorize("laborTemplates:view"), controller.lines)
router.put("/lines/:code", authorize("laborTemplates:edit"), validate(laborLineCodeSchema, "params"), validate(saveLaborLineSchema), controller.saveLine)
router.post("/preview", authorize("laborTemplates:view"), validate(laborCalculationSchema), controller.preview)
router.get("/", authorize("laborTemplates:view"), validate(laborTemplateQuerySchema, "query"), controller.index)
router.post("/", authorize("laborTemplates:create"), validate(saveLaborTemplateSchema), controller.save)
router.get("/:id/revisions", authorize("laborTemplates:view"), validate(laborTemplateIdSchema, "params"), controller.revisions)
router.get("/:id/revisions/:revision", authorize("laborTemplates:view"), validate(laborRevisionParamSchema, "params"), controller.revision)
router.get("/:id", authorize("laborTemplates:view"), validate(laborTemplateIdSchema, "params"), controller.show)
router.put("/:id", authorize("laborTemplates:edit"), validate(laborTemplateIdSchema, "params"), validate(saveLaborTemplateSchema), controller.save)

export default router
