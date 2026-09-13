import { Router } from "express"
import { siteImageController } from "../controllers/siteImage.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { siteImageSlotParamSchema, updateSiteImageSchema } from "../schemas/siteImage.schema"

const adminSiteImageRouter = Router()

adminSiteImageRouter.use(authenticate)

adminSiteImageRouter.get("/", authorize("siteContent:edit"), siteImageController.index)
adminSiteImageRouter.put(
    "/:slotKey",
    authorize("siteContent:edit"),
    validate(siteImageSlotParamSchema, "params"),
    validate(updateSiteImageSchema),
    siteImageController.upsert
)

export default adminSiteImageRouter
