import { AppError } from "../../../shared/errors/AppError"

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

// Validate before the shared image resolver can delete or upload anything in S3.
export function assertSubCategoryImage(image: string | null | undefined): void {
    if (image == null) return
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image)
    if (!match) throw new AppError(422, "errors.subcategory_image_invalid")
    const encoded = match[2]
    if (encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
        throw new AppError(422, "errors.subcategory_image_too_large")
    }
    const buffer = Buffer.from(encoded, "base64")
    if (buffer.length > MAX_IMAGE_BYTES) throw new AppError(422, "errors.subcategory_image_too_large")
    const valid = encoded === buffer.toString("base64") && (
        (match[1] === "image/png" && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
        (match[1] === "image/jpeg" && buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) ||
        (match[1] === "image/webp" && buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP")
    )
    if (!valid) throw new AppError(422, "errors.subcategory_image_invalid")
}
