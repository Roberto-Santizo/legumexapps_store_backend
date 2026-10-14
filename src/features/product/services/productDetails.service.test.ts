jest.mock("../../../config/env", () => ({ env: { databaseUrl: "postgres://test:test@localhost:5432/test", nodeEnv: "test" } }))
jest.mock("../../../database/seeders", () => ({ runSeeders: jest.fn() }))

import sequelize from "../../../database/connection"
import Product from "../models/Product.model"
import { getFixedProductDetails } from "./productDetails.service"

afterEach(() => jest.restoreAllMocks())
afterAll(async () => sequelize.close())

test("reads inactive fixed products without translating stored names or writing", async () => {
    const details = { id: 1, isActive: false, displayName: "Stored name", productVariants: [] }
    const find = jest.spyOn(Product, "findOne").mockResolvedValue({ toJSON: () => details } as Product)
    const create = jest.spyOn(Product, "create")
    const update = jest.spyOn(Product, "update")
    expect(await getFixedProductDetails(1)).toBe(details)
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }))
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
})

test("missing or customizable products are not returned", async () => {
    jest.spyOn(Product, "findOne").mockResolvedValue(null)
    await expect(getFixedProductDetails(77)).rejects.toMatchObject({ statusCode: 404 })
})

test("all projected columns and eager-load aliases exist in registered Sequelize metadata", async () => {
    const find = jest.spyOn(Product, "findOne").mockResolvedValue({ toJSON: () => ({ id: 1 }) } as Product)
    await getFixedProductDetails(1)
    const query = find.mock.calls[0][0] as any
    let hasManyCount = 0
    function verify(model: any, options: any) {
        for (const attribute of options.attributes ?? []) expect(model.rawAttributes).toHaveProperty(attribute)
        for (const [key] of options.order ?? []) expect(model.rawAttributes).toHaveProperty(key)
        for (const include of options.include ?? []) {
            const association = model.associations[include.as]
            expect(association).toBeDefined()
            expect(association.target).toBe(include.model)
            expect(include.where).toBeUndefined() // Retain inactive associations/materials for admin inspection.
            if (association.associationType === "HasMany") {
                hasManyCount++
                expect(include.separate).toBe(true)
            }
            verify(include.model, include)
        }
    }
    verify(Product, query)
    expect(hasManyCount).toBe(6)
    expect(find).toHaveBeenCalledTimes(1)
})
