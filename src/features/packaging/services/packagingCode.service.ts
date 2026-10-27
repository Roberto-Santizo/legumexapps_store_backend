import { Op, Transaction } from "sequelize"
import Packaging from "../models/Packaging.model"

// Generic materials never get a code from the user: the system assigns one short pattern per level.
const GENERIC_CODE_PREFIX: Record<string, string> = { unit: "GEN-IND", intermediate: "GEN-INT", pallet: "GEN-PAL" }

function formatGenericCode(role: string, sequence: number): string {
    return `${GENERIC_CODE_PREFIX[role]}-${String(sequence).padStart(4, "0")}`
}

// Serializes code assignment; callers run inside the same transaction as the insert.
export async function lockGenericCodes(transaction: Transaction): Promise<void> {
    await Packaging.sequelize!.query("SELECT pg_advisory_xact_lock(174226, 4)", { transaction })
}

// Next `count` free codes of a level, continuing after the highest existing GEN-XXX-NNNN.
export async function nextGenericCodes(role: string, count: number, transaction: Transaction): Promise<string[]> {
    const prefix = GENERIC_CODE_PREFIX[role]
    const rows = await Packaging.findAll({ attributes: ["code"], where: { code: { [Op.like]: `${prefix}-%` } }, transaction })
    const pattern = new RegExp(`^${prefix}-(\\d+)$`)
    const highest = rows.reduce((max, row) => Math.max(max, Number(pattern.exec(row.code)?.[1] ?? 0)), 0)
    return Array.from({ length: count }, (_, index) => formatGenericCode(role, highest + index + 1))
}
