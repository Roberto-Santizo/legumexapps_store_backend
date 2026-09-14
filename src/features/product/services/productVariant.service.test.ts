import "reflect-metadata"
import { Op } from "sequelize"


jest.mock("../models/ProductVariant.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn(), create: jest.fn() }
}))

import ProductVariant from "../models/ProductVariant.model"
import { productVariantService } from "./productVariant.service"

const mockVariantFindOne = ProductVariant.findOne as unknown as jest.Mock
const mockVariantCreate = ProductVariant.create as unknown as jest.Mock

const BASE_CREATE_INPUT = {
    productId: 1,
    skuCode: "PAB1310105",
    boxesPerPallet: 385,
    bagsPerBox: 6,
}

describe("productVariantService.createProductVariant", () => {
    beforeEach(() => {
        mockVariantFindOne.mockReset()
        mockVariantCreate.mockReset()
    })

    it("rechaza crear una variante si el skuCode ya existe, sin llegar a ProductVariant.create", async () => {
        mockVariantFindOne.mockResolvedValueOnce({ id: 9, skuCode: "PAB1310105" })

        await expect(productVariantService.createProductVariant(BASE_CREATE_INPUT)).rejects.toMatchObject({
            statusCode: 409,
            key: "errors.product_variant_skucode_already_exists",
            params: { skuCode: "PAB1310105" },
        })
        expect(mockVariantCreate).not.toHaveBeenCalled()
    })

    it("la unicidad es case-insensitive (Op.iLike) -- \"pab1310105\" colisiona con \"PAB1310105\" ya existente", async () => {
        mockVariantFindOne.mockResolvedValueOnce({ id: 9, skuCode: "PAB1310105" })

        await expect(
            productVariantService.createProductVariant({ ...BASE_CREATE_INPUT, skuCode: "pab1310105" })
        ).rejects.toMatchObject({ key: "errors.product_variant_skucode_already_exists" })

        expect(mockVariantFindOne).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ skuCode: { [Op.iLike]: "pab1310105" } }) })
        )
    })

    it("crea la variante cuando el skuCode todavía no existe", async () => {
        mockVariantFindOne.mockResolvedValue(null)
        mockVariantCreate.mockResolvedValue({ id: 1, ...BASE_CREATE_INPUT })

        const result = await productVariantService.createProductVariant(BASE_CREATE_INPUT)

        expect(mockVariantCreate).toHaveBeenCalledWith(expect.objectContaining({ skuCode: "PAB1310105" }))
        expect(result.skuCode).toBe("PAB1310105")
    })
})

describe("productVariantService.updateProductVariant", () => {
    beforeEach(() => {
        mockVariantFindOne.mockReset()
    })

    it("rechaza actualizar el skuCode a uno que ya usa OTRA variante, excluyendo el propio id de la búsqueda", async () => {
        const mockUpdate = jest.fn()
        mockVariantFindOne.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
            if ("id" in where && !("skuCode" in where)) return Promise.resolve({ id: 1, skuCode: "OLD-001", update: mockUpdate }) // getProductVariantById
            if ("skuCode" in where) return Promise.resolve({ id: 2, skuCode: "NEW-001" }) // otra variante ya tiene ese skuCode
            return Promise.resolve(null)
        })

        await expect(
            productVariantService.updateProductVariant(1, { ...BASE_CREATE_INPUT, skuCode: "NEW-001" })
        ).rejects.toMatchObject({ statusCode: 409, key: "errors.product_variant_skucode_already_exists" })

        expect(mockVariantFindOne).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ skuCode: { [Op.iLike]: "NEW-001" }, id: { [Op.ne]: 1 } }) })
        )
        expect(mockUpdate).not.toHaveBeenCalled()
    })

    it("permite guardar sin cambiar de skuCode (la unicidad no se compara consigo misma)", async () => {
        const mockUpdate = jest.fn().mockResolvedValue(undefined)
        mockVariantFindOne.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
            if ("id" in where && !("skuCode" in where)) return Promise.resolve({ id: 1, skuCode: "PAB1310105", update: mockUpdate })
            if ("skuCode" in where) return Promise.resolve(null) // nadie más usa "PAB1310105"
            return Promise.resolve(null)
        })

        await productVariantService.updateProductVariant(1, BASE_CREATE_INPUT)

        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ skuCode: "PAB1310105" }))
    })
})

describe("productVariantService.findVariantConfigBySkuCode (autofill)", () => {
    beforeEach(() => {
        mockVariantFindOne.mockReset()
    })

    it("devuelve la configuración completa (presentación, palet, materiales) de un SKU encontrado", async () => {
        mockVariantFindOne.mockResolvedValue({
            skuCode: "PAB1310105",
            productId: 7,
            presentationId: 3,
            boxesPerPallet: 385,
            bagsPerBox: 6,
            intermediatePackagingId: null,
            unitsPerIntermediatePackage: null,
            parentProduct: { displayName: "Better Goods Pineapple Juice" },
            sizePresentation: { displayLabel: "Botella 12 oz (0.75 lb)" },
            unitMaterials: [
                { packagingId: 10, quantityPerUnit: 1, usedUnitMaterial: { displayName: "Tapa con rosca Plastica BERICAP" } },
                { packagingId: 11, quantityPerUnit: 1, usedUnitMaterial: { displayName: "Envase PET Cilindrico 354 ml 44 G" } },
            ],
            palletMaterials: [
                { packagingId: 12, quantityValue: 385, usedPalletMaterial: { displayName: "Caja Genérica Jugos Walmart 6x354ml" } },
            ],
        })

        const result = await productVariantService.findVariantConfigBySkuCode("PAB1310105")

        expect(result).toEqual({
            skuCode: "PAB1310105",
            productId: 7,
            productDisplayName: "Better Goods Pineapple Juice",
            presentationId: 3,
            presentationLabel: "Botella 12 oz (0.75 lb)",
            boxesPerPallet: 385,
            bagsPerBox: 6,
            intermediatePackagingId: null,
            unitsPerIntermediatePackage: null,
            unitMaterials: [
                { packagingId: 10, displayName: "Tapa con rosca Plastica BERICAP", quantity: 1 },
                { packagingId: 11, displayName: "Envase PET Cilindrico 354 ml 44 G", quantity: 1 },
            ],
            palletMaterials: [
                { packagingId: 12, displayName: "Caja Genérica Jugos Walmart 6x354ml", quantity: 385 },
            ],
        })
    })

    it("la búsqueda es case-insensitive (Op.iLike)", async () => {
        mockVariantFindOne.mockResolvedValue({
            skuCode: "PAB1310105", productId: 1, presentationId: null, boxesPerPallet: null, bagsPerBox: null,
            intermediatePackagingId: null, unitsPerIntermediatePackage: null, parentProduct: {}, unitMaterials: [], palletMaterials: [],
        })

        await productVariantService.findVariantConfigBySkuCode("pab1310105")

        expect(mockVariantFindOne).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ skuCode: { [Op.iLike]: "pab1310105" } }) })
        )
    })

    it("es 404-safe: rechaza con un error claro (no revienta) cuando el SKU no existe, sin devolver ningún dato", async () => {
        mockVariantFindOne.mockResolvedValue(null)

        await expect(productVariantService.findVariantConfigBySkuCode("NO-EXISTE")).rejects.toMatchObject({
            statusCode: 404,
            key: "errors.product_variant_sku_not_found",
            params: { skuCode: "NO-EXISTE" },
        })
    })
})
