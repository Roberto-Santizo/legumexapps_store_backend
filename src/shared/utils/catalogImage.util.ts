import { uploadImage, deleteImage, isBase64Image, getS3Url, getKeyFromUrl } from "../services/s3.service"

// Maneja de forma consistente el campo "image" que mandan los forms de admin (ver
// product.schema.ts/category.schema.ts, "image" no es una columna real). El caller pasa el
// imageUrl actual del registro (o null/undefined si no tiene) y lo que vino en el body:
// - string base64 nueva  -> borra la imagen anterior en S3 (si había) y sube la nueva, devuelve su URL.
// - null                 -> borra la imagen anterior en S3 (si había), devuelve null (sin foto).
// - undefined (no vino)  -> no se tocó el campo: no hace ninguna llamada a S3, devuelve undefined
//                           para que el caller NO incluya "imageUrl" en el .update() y así deje
//                           el valor existente intacto.
export async function resolveCatalogImage(
    currentImageUrl: string | null | undefined,
    image: string | null | undefined,
    folder: string
): Promise<string | null | undefined> {
    if (image === undefined) return undefined

    if (currentImageUrl) {
        await deleteImage(getKeyFromUrl(currentImageUrl))
    }

    if (image === null) return null

    // Por si algún día "image" llega siendo ya una URL de S3 en vez de base64 (no debería pasar
    // desde los forms actuales, que siempre mandan base64 o null) -- no la vuelve a subir.
    if (!isBase64Image(image)) return image

    const key = await uploadImage(image, folder)
    return getS3Url(key)
}
