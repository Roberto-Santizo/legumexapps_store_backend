import type { Transaction } from "sequelize"
import ProductVariant from "../models/ProductVariant.model"

// Serialize changes to alternative groups, including moves between variants and levels.
// All reads, demotions and writes use the same transaction so a failure restores the old default.
export function withMaterialWriteTransaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
    return ProductVariant.sequelize!.transaction(async transaction => {
        await lockMaterialWrites(transaction)
        return work(transaction)
    })
}

export async function lockMaterialWrites(transaction: Transaction): Promise<void> {
    await ProductVariant.sequelize!.query("SELECT pg_advisory_xact_lock(174228, 1)", { transaction })
}
