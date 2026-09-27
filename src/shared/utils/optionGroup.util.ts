// Grupos de opciones de empaque (2026-09-24, ver CLAUDE.md #4 "Packaging default + optional"):
// el admin escribe el nombre del grupo como texto libre por fila (ProductVariantUnitMaterial/
// IntermediateMaterial/PalletMaterial.optionGroup). Estas funciones puras son la única fuente de
// verdad de "¿son el mismo grupo?", usadas tanto al guardar (servicios de materiales) como al
// cotizar (quote.service.ts), para que "Caja", "caja" y " caja  " nunca terminen como tres grupos.

/** Recorta y colapsa espacios internos. Vacío (o null/undefined) → null = fila fija, sin grupo. */
export function normalizeOptionGroup(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null
    const collapsed = value.trim().split(/\s+/).join(" ")
    return collapsed === "" ? null : collapsed
}

/** Clave de comparación insensible a mayúsculas/espacios. null para una fila fija. */
export function optionGroupKey(value: string | null | undefined): string | null {
    return normalizeOptionGroup(value)?.toLowerCase() ?? null
}

export function isSameOptionGroup(a: string | null | undefined, b: string | null | undefined): boolean {
    const keyA = optionGroupKey(a)
    return keyA !== null && keyA === optionGroupKey(b)
}

/**
 * Normaliza el grupo pedido y, si alguna fila hermana ya usa un nombre equivalente, devuelve esa
 * grafía exacta (así "caja" se une al "Caja" existente en vez de crear un grupo nuevo).
 */
export function resolveOptionGroupSpelling(
    requested: string | null | undefined,
    existingGroups: (string | null | undefined)[]
): string | null {
    const normalized = normalizeOptionGroup(requested)
    if (normalized === null) return null
    const match = existingGroups.find(existing => isSameOptionGroup(existing, normalized))
    return normalizeOptionGroup(match) ?? normalized
}
