import { Router } from "express"
import { salespersonController } from "../controllers/salesperson.controller"
import { createSalespersonSchema, hasInitialClients, salespersonIdParamSchema, updateSalespersonSchema, updateSalespersonStatusSchema, salespersonQuerySchema } from "../schemas/salesperson.schema"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize, authorizeWhen } from "../../../shared/middlewares/authorize"
import { representativeClientController } from "../controllers/representativeClient.controller"
import { representativeClientParamsSchema, representativeClientRemoveParamsSchema, assignRepresentativeClientsSchema } from "../schemas/representativeClient.schema"

const salespersonRouter = Router()

salespersonRouter.use(authenticate)

salespersonRouter.get("/:id/clients", authorize("salespeople:view"), authorize("clients:view"),
    validate(representativeClientParamsSchema, "params"), representativeClientController.list)
salespersonRouter.put("/:id/clients", authorize("salespeople:edit"), authorize("clients:view"),
    validate(representativeClientParamsSchema, "params"), validate(assignRepresentativeClientsSchema), representativeClientController.assign)
salespersonRouter.put("/:id/clients/all", authorize("salespeople:edit"), authorize("clients:view"),
    validate(representativeClientParamsSchema, "params"), representativeClientController.assignAll)
salespersonRouter.delete("/:id/clients/:clientId", authorize("salespeople:edit"), authorize("clients:view"),
    validate(representativeClientRemoveParamsSchema, "params"), representativeClientController.remove)

salespersonRouter.get("/", authorize("salespeople:view"), validate(salespersonQuerySchema, "query"), salespersonController.index)
salespersonRouter.get("/:id", authorize("salespeople:view"), validate(salespersonIdParamSchema, "params"), salespersonController.show)
// Assigning clients while creating requires the same client permission as the assignment routes.
salespersonRouter.post("/", authorize("salespeople:create"), validate(createSalespersonSchema),
    authorizeWhen(hasInitialClients, "clients:view"), salespersonController.store)
salespersonRouter.patch(
    "/:id",
    authorize("salespeople:edit"),
    validate(salespersonIdParamSchema, "params"),
    validate(updateSalespersonSchema),
    salespersonController.update
)
salespersonRouter.patch(
    "/:id/status",
    authorize("salespeople:edit"),
    validate(salespersonIdParamSchema, "params"),
    validate(updateSalespersonStatusSchema),
    salespersonController.updateStatus
)
salespersonRouter.delete("/:id", authorize("salespeople:delete"), validate(salespersonIdParamSchema, "params"), salespersonController.destroy)

export default salespersonRouter
