// Register real Sequelize metadata only. Never authenticate, sync or execute SQL.
jest.mock("../../../config/env", () => ({ env: { databaseUrl: "postgres://test:test@localhost:5432/test", nodeEnv: "test" } }))
jest.mock("../../../database/seeders", () => ({ runSeeders: jest.fn() }))

import sequelize from "../../../database/connection"
import Juice from "./Juice.model"
import Raw from "./JuiceRawMaterial.model"
import Presentation from "./JuicePresentation.model"
import Mix from "./JuiceMix.model"
import Spice from "./JuiceSpice.model"
import SpiceMaterial from "./JuiceSpiceMaterial.model"
import Global from "./JuiceCostConstants.model"
import Override from "./JuiceClientConstantOverride.model"
import Client from "../../client/models/Client.model"
import { JUICE_CONSTANT_FIELDS } from "../constants/juice.constant"

describe("registered juice model metadata", () => {
    test("source price, raw/spice and packaging costs preserve 12-place workbook precision", () => {
        for (const [model, key] of [[Juice, "pricePerPound"], [Raw, "costPerUnit"], [Raw, "costPerLiter"], [SpiceMaterial, "costPerGram"], [Presentation, "bottleUnitCost"], [Presentation, "stickerUnitCost"]] as const) {
            expect(String(model.rawAttributes[key].type)).toBe("DECIMAL(24,12)")
        }
    })
    test.each([Juice, Raw, Presentation, Mix, Spice, SpiceMaterial, Global, Override])("%s is registered independently of product catalogs", model => {
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
        expect(Override.associations.client.target).toBe(Client)
    })
    test("global singleton is versioned and every nullable override has the same storage type", () => {
        expect(Global.options.version).toBe("revision")
        expect(Global.options.indexes).toEqual(expect.arrayContaining([expect.objectContaining({ unique: true, fields: ["singletonKey"] })]))
        for (const key of JUICE_CONSTANT_FIELDS) {
            expect(Global.rawAttributes[key].allowNull).toBe(false)
            expect(Override.rawAttributes[key].allowNull).toBe(true)
            expect(String(Override.rawAttributes[key].type)).toBe(String(Global.rawAttributes[key].type))
        }
        expect(new Global().get("revision")).toBe(0)
    })
    test("unique recipe identities survive soft delete; catalog uniqueness uses lower(code)", () => {
        expect(Mix.options.indexes).toEqual(expect.arrayContaining([expect.objectContaining({ unique: true, fields: ["juiceId", "rawMaterialId"] })]))
        expect(Spice.options.indexes).toEqual(expect.arrayContaining([expect.objectContaining({ unique: true, fields: ["juiceId", "spiceMaterialId"] })]))
        expect(Override.options.indexes).toEqual(expect.arrayContaining([expect.objectContaining({ unique: true, fields: ["clientId"] })]))
        expect(JSON.stringify(Raw.options.indexes)).toContain('"fn":"lower"')
        expect(Presentation.rawAttributes.mlPerBottle.allowNull).toBe(false)
        expect(Presentation.rawAttributes.marginPerCase.allowNull).toBe(false)
        expect(Raw.rawAttributes.costPerLiter.allowNull).toBe(false)
    })
})
