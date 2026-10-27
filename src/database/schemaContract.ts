import type { Sequelize } from "sequelize-typescript"

/** PostgreSQL's stable default constraint names, including its 63-byte identifier limit. */
export function constraintName(table: string, fields: string[], suffix: string): string {
    let left = table, right = fields.join("_")
    const budget = 63 - Buffer.byteLength(suffix) - (right ? 2 : 1)
    while (Buffer.byteLength(left + right) > budget) {
        if (Buffer.byteLength(left) > Buffer.byteLength(right)) left = left.slice(0, -1)
        else right = right.slice(0, -1)
    }
    return [left, right, suffix].filter(Boolean).join("_")
}
export function currentModelContract(db: Sequelize) {
    return db.modelManager.models.map(model => {
        const table = String(model.getTableName())
        const attributes = Object.values(model.rawAttributes)
        const primary = attributes.filter(attr => attr.primaryKey).map(attr => attr.field!)
        // PostgreSQL folds a redundant through-table UNIQUE into the identical primary key.
        const unique = Object.values((model as any).uniqueKeys ?? {}).map((key: any) => key.fields as string[])
            .filter(fields => JSON.stringify(fields) !== JSON.stringify(primary))
            .map(fields => ({ name: constraintName(table, fields, "key"), fields }))
        const foreign = attributes.filter(attr => attr.references).map(attr => {
            const reference = attr.references as any
            return { name: constraintName(table, [attr.field!], "fkey"), field: attr.field!,
                target: typeof reference.model === "string" ? reference.model : reference.model.tableName,
                key: reference.key ?? "id", onDelete: attr.onDelete, onUpdate: attr.onUpdate }
        })
        const indexes = [
            { name: constraintName(table, [], "pkey"), unique: true, fields: primary },
            ...unique.map(key => ({ name: key.name, unique: true, fields: key.fields })),
            ...(model.options.indexes ?? []),
        ]
        return { table, primary, unique, foreign, indexes }
    })
}
