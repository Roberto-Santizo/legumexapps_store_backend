import { Router } from "express"
import { categoryController } from "../controllers/category.controller"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import { createCategorySchema, updateCategorySchema, updateCategoryStatusSchema, categoryIdParamSchema, categoryQuerySchema } from "../schemas/category.schema"

const categoryRouter = Router()

categoryRouter.use(authenticate)

categoryRouter.get("/", authorize("categories:view"), validate(categoryQuerySchema, "query"), categoryController.index)
categoryRouter.get("/:id", authorize("categories:view"), validate(categoryIdParamSchema, "params"), categoryController.show)
categoryRouter.post("/", authorize("categories:create"), validate(createCategorySchema), categoryController.store)
categoryRouter.put("/:id", authorize("categories:edit"), validate(categoryIdParamSchema, "params"), validate(updateCategorySchema), categoryController.update)
categoryRouter.patch("/:id/status", authorize("categories:edit"), validate(categoryIdParamSchema, "params"), validate(updateCategoryStatusSchema), categoryController.updateStatus)
categoryRouter.delete("/:id", authorize("categories:delete"), validate(categoryIdParamSchema, "params"), categoryController.destroy)

export default categoryRouter
