import "reflect-metadata"
import { Sequelize } from "sequelize-typescript"
import { databaseModels } from "../../../database/models"
import RawMaterial from "./RawMaterial.model"
import { createRawMaterialSchema, updateRawMaterialSchema } from "../schemas/rawMaterial.schema"

const sequelize = new Sequelize({ dialect: "postgres", logging: false, models: databaseModels })
afterAll(async () => { await sequelize.close() })

test("legacy requests cannot set eligibility; mandatory cost and code validation remain intact", () => {
    const input = { code: "SYN-001", displayName: "Synthetic raw", ingredientType: "fruit", costPerUnit: 2.5, isMixable: false }
    for (const schema of [createRawMaterialSchema, updateRawMaterialSchema]) {
        expect(schema.parse(input)).not.toHaveProperty("isMixable")
        expect(schema.safeParse({ ...input, costPerUnit: -1 }).success).toBe(false)
        expect(schema.safeParse({ ...input, code: "" }).success).toBe(false)
    }
})

test("retired storage is absent from model metadata and serialized rows", () => {
    expect(RawMaterial.getAttributes()).not.toHaveProperty("isMixable")
    const raw = RawMaterial.build({ code: "SYN-001", displayName: "Synthetic raw", isMixable: false } as any)
    expect(raw.toJSON()).not.toHaveProperty("isMixable")
})

test("normal raw-material SELECT queries omit the legacy column without opening a connection", async () => {
    const query = jest.spyOn(sequelize, "query").mockResolvedValue([] as never)
    try {
        await RawMaterial.findAll()
        expect(query).toHaveBeenCalledTimes(1)
        expect(String(query.mock.calls[0][0])).not.toContain("isMixable")
        expect(String(query.mock.calls[0][0])).toContain('"rawMaterials"')
    } finally { query.mockRestore() }
})
