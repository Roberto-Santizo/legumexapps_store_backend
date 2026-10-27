import { synchronizeSchema } from "./schemaSync"
import type { Sequelize } from "sequelize-typescript"

test("rejects Sequelize's cyclic-reference fallback before any connection or DDL", async () => {
    const transaction = jest.fn()
    const db = { modelManager: { getModelsTopoSortedByForeignKey: () => null }, transaction } as unknown as Sequelize
    await expect(synchronizeSchema(db)).rejects.toThrow("cyclic foreign keys")
    expect(transaction).not.toHaveBeenCalled()
})
