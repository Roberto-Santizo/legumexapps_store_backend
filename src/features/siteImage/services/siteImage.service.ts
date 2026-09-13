import { Op } from "sequelize"
import SiteImage, { SITE_IMAGE_SLOTS, SiteImageSlotKey } from "../models/SiteImage.model"
import { resolveCatalogImage } from "../../../shared/utils/catalogImage.util"
import { UpdateSiteImageInput } from "../schemas/siteImage.schema"

const IMAGE_FOLDER = "site-images"

// El admin necesita ver TODOS los slots SIEMPRE, aunque nunca se haya subido nada para alguno --
// para eso arma una fila "virtual" (no persistida, .build()) por cada slot sin registro en BD,
// así el panel siempre muestra una tarjeta por slot con su preview vacío listo para subir.
async function listSiteImagesForAdmin(): Promise<SiteImage[]> {
    const existing = await SiteImage.findAll()
    const bySlot = new Map(existing.map((row) => [row.slotKey, row]))
    return SITE_IMAGE_SLOTS.map((slotKey) => bySlot.get(slotKey) ?? SiteImage.build({ slotKey, imageUrl: null, altText: null }))
}

// Público: la landing solo necesita los slots que de verdad tienen imagen -- para los demás usa
// su bundled default (ver useSiteImages.ts en el frontend).
async function listPublicSiteImages(): Promise<SiteImage[]> {
    return SiteImage.findAll({ where: { imageUrl: { [Op.ne]: null } } })
}

async function upsertSiteImage(slotKey: SiteImageSlotKey, input: UpdateSiteImageInput): Promise<SiteImage> {
    const [siteImage] = await SiteImage.findOrCreate({
        where: { slotKey },
        defaults: { slotKey, imageUrl: null, altText: null },
    })

    const imageUrl = await resolveCatalogImage(siteImage.imageUrl, input.image, IMAGE_FOLDER)

    return siteImage.update({
        ...(imageUrl !== undefined ? { imageUrl } : {}),
        ...(input.altText !== undefined ? { altText: input.altText } : {}),
    })
}

export const siteImageService = {
    listSiteImagesForAdmin,
    listPublicSiteImages,
    upsertSiteImage,
}
