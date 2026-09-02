import { Router } from "express"
import { subCategoryController } from "../controllers/subCategory.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { createSubCategorySchema, updateSubCategorySchema, updateSubCategoryStatusSchema, subCategoryIdParamSchema, subCategoryQuerySchema } from "../schemas/subCategory.schema"

const subCategoryRouter = Router()

subCategoryRouter.use(authenticate)

subCategoryRouter.get("/", authorize("subCategories:view"), validate(subCategoryQuerySchema, "query"), subCategoryController.index)
subCategoryRouter.get("/:id", authorize("subCategories:view"), validate(subCategoryIdParamSchema, "params"), subCategoryController.show)
subCategoryRouter.post("/", authorize("subCategories:create"), validate(createSubCategorySchema), subCategoryController.store)
subCategoryRouter.put("/:id", authorize("subCategories:edit"), validate(subCategoryIdParamSchema, "params"), validate(updateSubCategorySchema), subCategoryController.update)
subCategoryRouter.patch("/:id/status", authorize("subCategories:edit"), validate(subCategoryIdParamSchema, "params"), validate(updateSubCategoryStatusSchema), subCategoryController.updateStatus)
subCategoryRouter.delete("/:id", authorize("subCategories:delete"), validate(subCategoryIdParamSchema, "params"), subCategoryController.destroy)

export default subCategoryRouter
