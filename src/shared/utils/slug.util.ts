/**
 * Convierte texto libre (ej. displayName) en un slug de URL: minusculas,
 * sin acentos, espacios/simbolos reemplazados por guiones.
 */
export function slugify(text: string): string {
    const collapsed = text
        .toString()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "") // quita marcas diacriticas (acentos) tras normalizar
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")

    return trimHyphens(collapsed)
}

// Recorte manual (sin regex) de guiones al inicio/fin -- /^-+|-+$/g tiene backtracking
// O(n^2) en el peor caso para inputs no confiables (una racha larga de "-" que no llega
// justo al final del string), asi que se evita el motor de regex para esta parte.
function trimHyphens(value: string): string {
    let start = 0
    let end = value.length
    while (start < end && value[start] === "-") start++
    while (end > start && value[end - 1] === "-") end--
    return value.slice(start, end)
}

/**
 * Genera un slug unico a partir de un texto base, probando sufijos
 * -2, -3, ... hasta encontrar uno libre. `isTaken` decide, por cada
 * candidato, si ya existe (permite scoping, ej. unico por categoria).
 */
export async function generateUniqueSlug(
    baseText: string,
    isTaken: (candidate: string) => Promise<boolean>
): Promise<string> {
    const base = slugify(baseText) || "item"
    let candidate = base
    let suffix = 2

    while (await isTaken(candidate)) {
        candidate = `${base}-${suffix}`
        suffix += 1
    }

    return candidate
}
