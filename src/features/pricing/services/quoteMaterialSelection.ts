import { AppError } from "../../../shared/errors/AppError"
import { normalizeOptionGroup } from "../../../shared/utils/optionGroup.util"
import { materialGroupIdentity } from "../../../shared/utils/materialGroupIdentity.util"

// Resolución de grupos de opciones de empaque, compartida por el motor de productos definidos y por
// cualquier otro flujo que costee filas con optionGroup/isDefault (opera sobre GroupedMaterialRow).

export type MaterialLevel = "unit" | "intermediate" | "pallet"

export interface GroupedMaterialRow {
    // Opcional, no solo number -- sequelize-typescript tipa Model.id como opcional (una instancia
    // sin guardar aún no tiene id), aunque en la práctica cualquier fila leída de la BD siempre lo
    // trae.
    id?: number
    optionGroup: string | null
    optionGroupId?: number | null
    isDefault: boolean
}

// Claves literales por nivel (no armadas con template string) para que sigan siendo grep-ables
// contra los locales.
const MATERIAL_LEVEL_ERROR_KEYS: Record<MaterialLevel, { invalidSelection: string; defaultNotConfigured: string }> = {
    unit: {
        invalidSelection: "errors.invalid_unit_material_selection",
        defaultNotConfigured: "errors.unit_material_default_not_configured"
    },
    intermediate: {
        invalidSelection: "errors.invalid_intermediate_material_selection",
        defaultNotConfigured: "errors.intermediate_material_default_not_configured"
    },
    pallet: {
        invalidSelection: "errors.invalid_pallet_material_selection",
        defaultNotConfigured: "errors.pallet_material_default_not_configured"
    }
}

export interface MaterialOptionGroupBucket<T> {
    label: string
    rows: T[]
}

// Agrupa las filas de un nivel por la clave normalizada de optionGroup (insensible a mayúsculas/
// espacios, misma regla que usan los servicios al guardar -- ver shared/utils/optionGroup.util.ts).
// Las filas sin grupo son la receta fija. Orden estable por id, para que el menú del catálogo y el
// snapshot no dependan del orden en que Sequelize devolvió el include.
export function bucketMaterialsByGroup<T extends GroupedMaterialRow>(
    allRows: T[]
): { fixedRows: T[]; groups: Map<string, MaterialOptionGroupBucket<T>> } {
    const sortedRows = [...allRows].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
    const fixedRows: T[] = []
    const groups = new Map<string, MaterialOptionGroupBucket<T>>()
    for (const row of sortedRows) {
        const key = materialGroupIdentity(row)
        if (key === null) {
            fixedRows.push(row)
            continue
        }
        const bucket = groups.get(key) ?? { label: normalizeOptionGroup(row.optionGroup) ?? key, rows: [] }
        bucket.rows.push(row)
        groups.set(key, bucket)
    }
    return { fixedRows, groups }
}

// Un mismo resolver para los tres niveles. Devuelve las filas fijas (siempre se costean) + UNA fila
// por grupo: la que eligió el cliente, o si no mandó ninguna, el default del grupo. Nunca confía en
// el cliente: cada id enviado debe ser una fila AGRUPADA de este SKU en ESTE nivel (el grupo se lee
// de la fila), y dos ids del mismo grupo se rechazan en vez de costear ambos o elegir uno en silencio.
// Solo decide QUÉ filas se suman; la matemática por fila vive en quoteCostLines.ts.
export function resolveMaterialsForQuote<T extends GroupedMaterialRow>(
    allRows: T[],
    selectedIds: number[] | undefined,
    level: MaterialLevel
): T[] {
    const errorKeys = MATERIAL_LEVEL_ERROR_KEYS[level]
    const { fixedRows, groups } = bucketMaterialsByGroup(allRows)

    const chosenByGroup = new Map<string, T>()
    for (const selectedId of selectedIds ?? []) {
        const chosen = allRows.find(row => row.id === selectedId && materialGroupIdentity(row) !== null)
        if (!chosen) throw new AppError(422, errorKeys.invalidSelection, { selectedId })

        const key = materialGroupIdentity(chosen) as string
        if (chosenByGroup.has(key)) {
            throw new AppError(422, "errors.duplicate_material_group_selection", { group: groups.get(key)?.label ?? key })
        }
        chosenByGroup.set(key, chosen)
    }

    const resolvedRows = [...fixedRows]
    for (const [key, bucket] of groups) {
        const resolved = chosenByGroup.get(key) ?? bucket.rows.find(row => row.isDefault)
        if (!resolved) throw new AppError(422, errorKeys.defaultNotConfigured, { group: bucket.label })
        resolvedRows.push(resolved)
    }
    return resolvedRows.sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
}
