jest.mock("../models/SubCategory.model", () => ({ __esModule: true, default: { findOne: jest.fn(), create: jest.fn(), findAll: jest.fn() } }))
jest.mock("../models/SubCategoryTranslation.model", () => ({ __esModule: true, default: { findOrCreate: jest.fn() } }))
jest.mock("../../../shared/services/s3.service", () => ({
    uploadImage: jest.fn(), deleteImage: jest.fn(),
    isBase64Image: (value: string) => value.startsWith("data:image/"),
    getKeyFromUrl: (url: string) => url.replace("https://bucket/", ""),
    getS3Url: (key: string) => `https://bucket/${key}`,
}))

import SubCategory from "../models/SubCategory.model"
import { subCategoryService } from "./subCategory.service"
import { assertSubCategoryImage } from "./subCategoryImage.validation"
import { createSubCategorySchema, updateSubCategorySchema } from "../schemas/subCategory.schema"
import { uploadImage, deleteImage } from "../../../shared/services/s3.service"

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6EIAAAAASUVORK5CYII="
const input = { categoryId: 1, displayName: "Berries" }
const findOne = jest.mocked(SubCategory.findOne)
const create = jest.mocked(SubCategory.create)
const upload = jest.mocked(uploadImage)
const remove = jest.mocked(deleteImage)

describe("optional subcategory images", () => {
    const update = jest.fn()
    let row: { id: number; imageUrl: string | null; update: typeof update }
    beforeEach(() => {
        jest.clearAllMocks()
        row = { id: 2, imageUrl: null, update }
        update.mockImplementation(async (changes: { imageUrl?: string | null }) => Object.assign(row, changes))
        findOne.mockImplementation(async (options) => {
            const where = options?.where as Record<string, unknown>
            return "urlSlug" in where ? null : row as unknown as SubCategory
        })
        create.mockImplementation(async (data) => Object.assign(row, data) as unknown as SubCategory)
        upload.mockResolvedValue("subcategories/new.png")
    })

    it("keeps creation without an image valid and returns null", async () => {
        expect(createSubCategorySchema.safeParse(input).success).toBe(true)
        const result = await subCategoryService.createSubCategory(input)
        expect(result.imageUrl).toBeNull()
        expect(upload).not.toHaveBeenCalled()
        expect(remove).not.toHaveBeenCalled()
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ imageUrl: null }))
    })

    it("uploads on create using the shared S3 resolver and stores only its URL", async () => {
        const result = await subCategoryService.createSubCategory({ ...input, image })
        expect(upload).toHaveBeenCalledWith(image, "subcategories")
        expect(result.imageUrl).toBe("https://bucket/subcategories/new.png")
        expect(create.mock.calls[0][0]).not.toHaveProperty("image")
    })

    it("adds an image when editing a subcategory without one", async () => {
        const result = await subCategoryService.updateSubCategory(2, { image })
        expect(result.imageUrl).toBe("https://bucket/subcategories/new.png")
        expect(remove).not.toHaveBeenCalled()
    })

    it("replaces an existing image through the shared resolver", async () => {
        row.imageUrl = "https://bucket/subcategories/old.png"
        await subCategoryService.updateSubCategory(2, { image })
        expect(remove).toHaveBeenCalledWith("subcategories/old.png")
        expect(upload).toHaveBeenCalledWith(image, "subcategories")
        expect(update).toHaveBeenCalledWith({ imageUrl: "https://bucket/subcategories/new.png" })
    })

    it("removes an image with null and returns null", async () => {
        row.imageUrl = "https://bucket/subcategories/old.png"
        expect(updateSubCategorySchema.safeParse({ image: null }).success).toBe(true)
        const result = await subCategoryService.updateSubCategory(2, { image: null })
        expect(result.imageUrl).toBeNull()
        expect(remove).toHaveBeenCalledWith("subcategories/old.png")
        expect(upload).not.toHaveBeenCalled()
    })

    it("preserves the image when an edit omits the field", async () => {
        row.imageUrl = "https://bucket/subcategories/old.png"
        await subCategoryService.updateSubCategory(2, { displayName: "New name" })
        expect(update).toHaveBeenCalledWith({ displayName: "New name" })
        expect(upload).not.toHaveBeenCalled()
        expect(remove).not.toHaveBeenCalled()
    })

    it("does not update the database when S3 upload fails", async () => {
        upload.mockRejectedValueOnce(new Error("Upload failed"))
        await expect(subCategoryService.updateSubCategory(2, { image })).rejects.toThrow("Upload failed")
        expect(update).not.toHaveBeenCalled()
    })

    it.each(["https://other/image.png", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,aGVsbG8=", "data:image/jpeg;base64,iVBORw0KGgo=", "data:image/png;base64,!!!!"])("rejects invalid image %s before S3 changes", async (invalid) => {
        row.imageUrl = "https://bucket/subcategories/old.png"
        await expect(subCategoryService.updateSubCategory(2, { image: invalid })).rejects.toMatchObject({ statusCode: 422, key: "errors.subcategory_image_invalid" })
        expect(upload).not.toHaveBeenCalled()
        expect(remove).not.toHaveBeenCalled()
        expect(update).not.toHaveBeenCalled()
    })

    it("rejects images exceeding 5 MiB", () => {
        const large = `data:image/png;base64,${Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64")}`
        expect(() => assertSubCategoryImage(large)).toThrow(expect.objectContaining({ key: "errors.subcategory_image_too_large" }))
    })

    it("accepts JPEG and WEBP MIME types with matching signatures", () => {
        expect(() => assertSubCategoryImage(`data:image/jpeg;base64,${Buffer.from([255, 216, 255, 224]).toString("base64")}`)).not.toThrow()
        expect(() => assertSubCategoryImage(`data:image/webp;base64,${Buffer.from("RIFF0000WEBPVP8 ").toString("base64")}`)).not.toThrow()
    })
})
