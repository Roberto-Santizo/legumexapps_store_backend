// Traducción de contenido de catálogo (Category/SubCategory/Product/Ingredient) -- NO confundir
// con src/config/i18n.ts, que traduce textos fijos de la UI/mensajes de error (req.t(...)).
//
// Decisión de diseño: el español NUNCA vive en una tabla de traducciones. Las columnas base
// (Category.displayName, Product.displayName, etc.) YA SON el contenido en español -- así nació
// el dato y así se sigue escribiendo desde los formularios admin. Las tablas *Translation solo
// guardan overrides para idiomas ADICIONALES (hoy: inglés). Ventajas de esto sobre el patrón
// "es y en viven los dos en la tabla de traducciones":
//   - Cero backfill de datos existentes (el contenido español ya está en su lugar).
//   - Cero riesgo sobre las columnas NOT NULL que ya existen en producción.
//   - Se preserva la ventaja real del patrón (agregar un idioma nuevo mañana = filas nuevas,
//     no columnas nuevas).
export type ContentLanguage = "es" | "en"

export const DEFAULT_CONTENT_LANGUAGE: ContentLanguage = "es"

// El header Accept-Language ya llega parseado por i18next-http-middleware (ver src/server.ts)
// como req.language -- normalmente "es" o "en", pero un navegador puede mandar variantes
// ("en-US", "es-GT"). Cualquier cosa que no empiece con "en" cae a español (mismo fallback que
// ya usa i18next en este mismo repo).
export function resolveContentLanguage(raw: string | string[] | undefined | null): ContentLanguage {
    const value = Array.isArray(raw) ? raw[0] : raw
    return typeof value === "string" && value.toLowerCase().startsWith("en") ? "en" : DEFAULT_CONTENT_LANGUAGE
}

interface NamedTranslationRow {
    language: string
    displayName: string
}

// Si language==="es" ni se mira el arreglo de traducciones (ver nota arriba: el español vive en
// baseName). Si no hay fila para el idioma pedido (admin no cargó la traducción todavía), cae a
// baseName en vez de mostrar vacío -- nunca se pierde el nombre del producto/categoría/ingrediente.
export function pickTranslatedName(
    baseName: string,
    translations: NamedTranslationRow[] | undefined,
    language: ContentLanguage
): string {
    if (language === DEFAULT_CONTENT_LANGUAGE) return baseName
    return translations?.find(translation => translation.language === language)?.displayName ?? baseName
}
