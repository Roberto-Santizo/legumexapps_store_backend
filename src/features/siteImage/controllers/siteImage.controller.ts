import { Request, Response, NextFunction } from "express"
import { siteImageService } from "../services/siteImage.service"
import { SiteImageSlot, UpdateSiteImageInput } from "../schemas/siteImage.schema"

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const siteImages = await siteImageService.listSiteImagesForAdmin()
        res.json({ data: siteImages })
    } catch (error) {
        next(error)
    }
}

async function publicIndex(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const siteImages = await siteImageService.listPublicSiteImages()
        res.json({ data: siteImages })
    } catch (error) {
        next(error)
    }
}

async function upsert(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { slotKey } = req.params as unknown as { slotKey: SiteImageSlot }
        const siteImage = await siteImageService.upsertSiteImage(slotKey, req.body as UpdateSiteImageInput)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.SiteImage") }),
            data: siteImage,
        })
    } catch (error) {
        next(error)
    }
}

export const siteImageController = {
    index,
    publicIndex,
    upsert,
}
