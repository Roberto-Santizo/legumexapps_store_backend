// Traducción de contenido de catálogo (Category/SubCategory/Product/RawMaterial) -- NO confundir
// con src/config/i18n.ts, que traduce textos fijos de la UI/mensajes de error (req.t(...)).
//
// El español nunca vive en una tabla de traducciones: las columnas base (Category.displayName,
// Product.displayName, etc.) son el contenido en español. Las tablas *Translation solo guardan
// overrides para idiomas adicionales (hoy: inglés); agregar un idioma = filas nuevas, no columnas.
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
// baseName en vez de mostrar vacío -- nunca se pierde el nombre del producto/categoría/materia prima.
export function pickTranslatedName(
    baseName: string,
    translations: NamedTranslationRow[] | undefined,
    language: ContentLanguage
): string {
    if (language === DEFAULT_CONTENT_LANGUAGE) return baseName
    return translations?.find(translation => translation.language === language)?.displayName ?? baseName
}
