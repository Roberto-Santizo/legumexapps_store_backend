import { Request, Response, NextFunction, RequestHandler } from "express"
import { customQuoteRawMaterialOptionService } from "../services/customQuoteRawMaterialOption.service"
import { customQuoteIngredientOptionService } from "../services/customQuoteIngredientOption.service"
import { customQuotePresentationOptionService } from "../services/customQuotePresentationOption.service"
import { customQuotePackagingOptionService } from "../services/customQuotePackagingOption.service"
import {
    ListCustomQuotePackagingOptionsQuery,
    ListCustomQuoteRawMaterialOptionsQuery
} from "../schemas/customQuoteConfig.schema"

// Las cuatro listas de permitidos tienen exactamente el mismo contrato HTTP (index/show/store/
// update/updateStatus, mismo shape de respuesta y mismos mensajes que client.controller.ts), así que
// se arman con una sola función en vez de repetir cinco handlers cuatro veces.
interface OptionHandlers {
    list: (req: Request) => Promise<unknown[]>
    getById: (id: number) => Promise<unknown>
    create: (body: never) => Promise<unknown>
    update: (id: number, body: never) => Promise<unknown>
    setStatus: (id: number, isActive: boolean) => Promise<unknown>
}

function buildOptionController(handlers: OptionHandlers, resourceKey: string): Record<string, RequestHandler> {
    return {
        async index(req: Request, res: Response, next: NextFunction): Promise<void> {
            try {
                res.json({ data: await handlers.list(req) })
            } catch (error) {
                next(error)
            }
        },
        async show(req: Request, res: Response, next: NextFunction): Promise<void> {
            try {
                res.json({ data: await handlers.getById(Number(req.params.id)) })
            } catch (error) {
                next(error)
            }
        },
        async store(req: Request, res: Response, next: NextFunction): Promise<void> {
            try {
                const data = await handlers.create(req.body as never)
                res.status(201).json({ message: req.t("success.created", { resource: req.t(`resources.${resourceKey}`) }), data })
            } catch (error) {
                next(error)
            }
        },
        async update(req: Request, res: Response, next: NextFunction): Promise<void> {
            try {
                const data = await handlers.update(Number(req.params.id), req.body as never)
                res.json({ message: req.t("success.updated", { resource: req.t(`resources.${resourceKey}`) }), data })
            } catch (error) {
                next(error)
            }
        },
        async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
            try {
                const { isActive } = req.body as { isActive: boolean }
                const data = await handlers.setStatus(Number(req.params.id), isActive)
                res.json({
                    message: req.t(isActive ? "success.activated" : "success.deactivated", { resource: req.t(`resources.${resourceKey}`) }),
                    data
                })
            } catch (error) {
                next(error)
            }
        },
    }
}

export const customQuoteRawMaterialOptionController = buildOptionController(
    {
        list: req => customQuoteRawMaterialOptionService.listRawMaterialOptions(
            (req.query as unknown as ListCustomQuoteRawMaterialOptionsQuery).subCategoryId
        ),
        getById: customQuoteRawMaterialOptionService.getRawMaterialOptionById,
        create: customQuoteRawMaterialOptionService.createRawMaterialOption,
        update: customQuoteRawMaterialOptionService.updateRawMaterialOption,
        setStatus: customQuoteRawMaterialOptionService.setRawMaterialOptionStatus,
    },
    "CustomQuoteRawMaterialOption"
)

export const customQuoteIngredientOptionController = buildOptionController(
    {
        list: () => customQuoteIngredientOptionService.listIngredientOptions(),
        getById: customQuoteIngredientOptionService.getIngredientOptionById,
        create: customQuoteIngredientOptionService.createIngredientOption,
        update: customQuoteIngredientOptionService.updateIngredientOption,
        setStatus: customQuoteIngredientOptionService.setIngredientOptionStatus,
    },
    "CustomQuoteIngredientOption"
)

export const customQuotePresentationOptionController = buildOptionController(
    {
        list: () => customQuotePresentationOptionService.listPresentationOptions(),
        getById: customQuotePresentationOptionService.getPresentationOptionById,
        create: customQuotePresentationOptionService.createPresentationOption,
        update: customQuotePresentationOptionService.updatePresentationOption,
        setStatus: customQuotePresentationOptionService.setPresentationOptionStatus,
    },
    "CustomQuotePresentationOption"
)

export const customQuotePackagingOptionController = buildOptionController(
    {
        list: req => customQuotePackagingOptionService.listPackagingOptions(
            (req.query as unknown as ListCustomQuotePackagingOptionsQuery).level
        ),
        getById: customQuotePackagingOptionService.getPackagingOptionById,
        create: customQuotePackagingOptionService.createPackagingOption,
        update: customQuotePackagingOptionService.updatePackagingOption,
        setStatus: customQuotePackagingOptionService.setPackagingOptionStatus,
    },
    "CustomQuotePackagingOption"
)
