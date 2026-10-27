// Register real Sequelize metadata only. Never authenticate, sync or execute SQL.
jest.mock("../../../config/env", () => ({ env: { databaseUrl: "postgres://test:test@localhost:5432/test", nodeEnv: "test" } }))

import sequelize from "../../../database/connection"
import Juice from "./Juice.model"
import Raw from "./JuiceRawMaterial.model"
import Presentation from "./JuicePresentation.model"
import Mix from "./JuiceMix.model"
import Spice from "./JuiceSpice.model"
import SpiceMaterial from "./JuiceSpiceMaterial.model"
import Client from "../../client/models/Client.model"

describe("registered juice model metadata", () => {
    test("source price, raw/spice and packaging costs preserve 12-place workbook precision", () => {
        for (const [model, key] of [[Raw, "costPerUnit"], [Raw, "costPerLiter"], [SpiceMaterial, "costPerGram"], [Presentation, "bottleUnitCost"], [Presentation, "stickerUnitCost"]] as const) {
            expect(String(model.rawAttributes[key].type)).toBe("DECIMAL(24,12)")
        }
    })
    test.each([Juice, Raw, Presentation, Mix, Spice, SpiceMaterial])("%s is registered independently of product catalogs", model => {
        expect(sequelize.modelManager.models).toContain(model)
        expect(model.tableName.startsWith("juice")).toBe(true)
    })
    test("all eager-load targets resolve to the expected juice models", () => {
        expect(Juice.associations.client.target).toBe(Client)
        expect(Juice.associations.presentations.target).toBe(Presentation)
        expect(Juice.associations.mix.target).toBe(Mix)
        expect(Juice.associations.spices.target).toBe(Spice)
        expect(Mix.associations.rawMaterial.target).toBe(Raw)
        expect(Spice.associations.spiceMaterial.target).toBe(SpiceMaterial)
    })
    test("unique recipe identities survive soft delete; catalog uniqueness uses lower(code)", () => {
        expect(Mix.options.indexes).toEqual(expect.arrayContaining([expect.objectContaining({ unique: true, fields: ["juiceId", "rawMaterialId"] })]))
        expect(Spice.options.indexes).toEqual(expect.arrayContaining([expect.objectContaining({ unique: true, fields: ["juiceId", "spiceMaterialId"] })]))
        expect(JSON.stringify(Raw.options.indexes)).toContain('"fn":"lower"')
        expect(Presentation.rawAttributes.mlPerBottle.allowNull).toBe(false)
        expect(Presentation.rawAttributes).not.toHaveProperty("marginPerCase")
        expect(Juice.rawAttributes).not.toHaveProperty("pricePerPound")
        expect(Raw.rawAttributes.costPerLiter.allowNull).toBe(false)
    })
})
