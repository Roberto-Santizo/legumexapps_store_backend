import { RequestHandler, Router } from "express"
import { ZodType } from "zod"
import { validate } from "../../../shared/middlewares/validate"
import { authenticate } from "../../../shared/middlewares/authenticate"
import { authorize } from "../../../shared/middlewares/authorize"
import {
    customQuoteIngredientOptionController,
    customQuotePackagingOptionController,
    customQuotePresentationOptionController,
    customQuoteRawMaterialOptionController
} from "../controllers/customQuoteConfig.controller"
import {
    createCustomQuoteIngredientOptionSchema,
    createCustomQuotePackagingOptionSchema,
    createCustomQuotePresentationOptionSchema,
    createCustomQuoteRawMaterialOptionSchema,
    customQuoteConfigIdParamSchema,
    customQuoteConfigStatusSchema,
    listCustomQuotePackagingOptionsQuerySchema,
    listCustomQuoteRawMaterialOptionsQuerySchema,
    updateCustomQuoteIngredientOptionSchema,
    updateCustomQuotePackagingOptionSchema,
    updateCustomQuotePresentationOptionSchema,
    updateCustomQuoteRawMaterialOptionSchema
} from "../schemas/customQuoteConfig.schema"

// Configuración de "Cotizaciones a la medida" (montado en /admin/custom-quote-config). Un solo
// permiso para leer y escribir, customQuoteConfig:edit: decide qué se puede cotizar y con qué
// cantidades, así que es un nivel de confianza aparte (mismo criterio que quotes:calculate vs.
// quotes:view), y la lista de permitidos no tiene lectores sin permiso de edición.
const customQuoteConfigRouter = Router()

customQuoteConfigRouter.use(authenticate)
customQuoteConfigRouter.use(authorize("customQuoteConfig:edit"))

interface OptionRouteConfig {
    path: string
    controller: Record<string, RequestHandler>
    createSchema: ZodType
    updateSchema: ZodType
    listQuerySchema?: ZodType
}

function mountOptionRoutes({ path, controller, createSchema, updateSchema, listQuerySchema }: OptionRouteConfig): void {
    const listValidators = listQuerySchema ? [validate(listQuerySchema, "query")] : []
    customQuoteConfigRouter.get(path, ...listValidators, controller.index)
    customQuoteConfigRouter.get(`${path}/:id`, validate(customQuoteConfigIdParamSchema, "params"), controller.show)
    customQuoteConfigRouter.post(path, validate(createSchema), controller.store)
    customQuoteConfigRouter.patch(
        `${path}/:id`,
        validate(customQuoteConfigIdParamSchema, "params"),
        validate(updateSchema),
        controller.update
    )
    customQuoteConfigRouter.patch(
        `${path}/:id/status`,
        validate(customQuoteConfigIdParamSchema, "params"),
        validate(customQuoteConfigStatusSchema),
        controller.updateStatus
    )
}

mountOptionRoutes({
    path: "/raw-material-options",
    controller: customQuoteRawMaterialOptionController,
    createSchema: createCustomQuoteRawMaterialOptionSchema,
    updateSchema: updateCustomQuoteRawMaterialOptionSchema,
    listQuerySchema: listCustomQuoteRawMaterialOptionsQuerySchema,
})
mountOptionRoutes({
    path: "/ingredient-options",
    controller: customQuoteIngredientOptionController,
    createSchema: createCustomQuoteIngredientOptionSchema,
    updateSchema: updateCustomQuoteIngredientOptionSchema,
})
mountOptionRoutes({
    path: "/presentation-options",
    controller: customQuotePresentationOptionController,
    createSchema: createCustomQuotePresentationOptionSchema,
    updateSchema: updateCustomQuotePresentationOptionSchema,
})
mountOptionRoutes({
    path: "/packaging-options",
    controller: customQuotePackagingOptionController,
    createSchema: createCustomQuotePackagingOptionSchema,
    updateSchema: updateCustomQuotePackagingOptionSchema,
    listQuerySchema: listCustomQuotePackagingOptionsQuerySchema,
})

export default customQuoteConfigRouter
