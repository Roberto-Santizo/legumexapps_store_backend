import { env } from "../../config/env"

// Punto único de integración con el servicio de tipo de cambio del Banco de Guatemala
// (Banguat) -- servicio público de terceros, sin autenticación, que responde XML y cuyo
// resultado va a multiplicar montos de dinero reales del cotizador. Diseño defensivo
// deliberado (análisis de riesgo hecho antes de escribir una sola línea):
//
// 1) XXE (XML External Entity injection): NO se usa un parser XML/DOM completo. Solo
//    necesitamos un número dentro de una respuesta de forma fija y conocida (<CambioDolar>
//    -> <VarDolar> -> <venta>), así que se extrae con un regex estricto que solo puede
//    capturar dígitos y un punto -- no hay <!ENTITY>/DTD que resolver, no hay superficie de
//    ataque de expansión de entidades (lectura de archivos locales, SSRF, billion laughs).
// 2) Validación de rango: el valor extraído se valida como número finito dentro de una franja
//    plausible de quetzales por dólar antes de aceptarse -- un dato corrupto, un cambio de
//    formato de Banguat, o un MITM no puede colar un tipo de cambio absurdo (ej. Q0.01 o
//    Q999,999 por dólar) que arruine una cotización real.
// 3) HTTPS + timeout: la URL se valida como https:// al cargar `env` (ver config/env.ts);
//    cada fetch tiene un timeout explícito vía AbortController -- un servicio externo
//    colgado nunca debe poder colgar el cálculo de una cotización.
// 4) Best-effort con fallback a cache: si Banguat falla o da timeout, se usa el último valor
//    cacheado (aunque esté vencido). Nunca se propaga el error hacia quien cotiza salvo que
//    NUNCA haya habido un valor válido (arranque en frío + Banguat caído a la vez).
// 5) Cache "single-flight": si el cache vence justo cuando llegan varias cotizaciones a la
//    vez, solo se dispara UN fetch a Banguat -- el resto espera esa misma promesa en vez de
//    generar una ráfaga de requests concurrentes al servicio externo.

// Regex estricto contra el fragmento real de la respuesta de Banguat:
//   <CambioDolar><VarDolar><fecha>.../fecha><referencia>.../referencia>
//     <compra>7.75000</compra><venta>7.80000</venta></VarDolar></CambioDolar>
// Solo se captura lo que hay entre <venta> y </venta>, y solo si aparece dentro de un bloque
// <CambioDolar>...</CambioDolar> -- si Banguat cambiara el formato de raíz, esto deja de
// matchear y se trata como respuesta inesperada (ver extractVentaRate), nunca se adivina.
const VENTA_PATTERN = /<CambioDolar>[\s\S]*?<venta>\s*(\d+(?:\.\d+)?)\s*<\/venta>[\s\S]*?<\/CambioDolar>/i

// Franja plausible de quetzales por dólar. Cualquier valor fuera de este rango se descarta
// como dato corrupto/inesperado y NUNCA se usa para cotizar -- ajustable si el tipo de cambio
// real se acerca a un extremo, pero debe seguir siendo una franja angosta a propósito (es la
// última línea de defensa contra "cotizar con un tipo de cambio absurdo").
const MIN_PLAUSIBLE_RATE = 5
const MAX_PLAUSIBLE_RATE = 15

interface CachedRate {
    rate: number
    fetchedAt: number
}

let cache: CachedRate | null = null

// Promesa del refresh en vuelo, si hay uno -- ver comentario de diseño (5) arriba.
let inFlightRefresh: Promise<number> | null = null

function isCacheFresh(entry: CachedRate | null): entry is CachedRate {
    if (!entry) return false
    return Date.now() - entry.fetchedAt < env.exchangeRateCacheTtlMs
}

// Envuelta en su propia función (en vez de leer `cache` directo en getUsdToGtqRate) a
// propósito: el narrowing de TypeScript sobre una variable mutable de módulo persiste a
// través de un `await` dentro de la MISMA función que hizo el chequeo -- si getUsdToGtqRate
// leyera `cache` de nuevo después del `await refreshCache()`, TS seguiría arrastrando el tipo
// `null` que dedujo del `if (isCacheFresh(cache))` de más arriba y marcaría `cache.rate` como
// inexistente en tipo `never`, aunque en runtime `cache` sí pueda haber cambiado. Una función
// nueva no hereda ese narrowing del llamador.
function getCachedRate(): number | null {
    return cache ? cache.rate : null
}

function extractVentaRate(xml: string): number {
    const match = VENTA_PATTERN.exec(xml)
    if (!match) {
        throw new Error("La respuesta de Banguat no tiene el formato esperado (no se encontró <venta> dentro de <CambioDolar>)")
    }

    const rate = Number(match[1])
    if (!Number.isFinite(rate) || rate < MIN_PLAUSIBLE_RATE || rate > MAX_PLAUSIBLE_RATE) {
        throw new Error(`Tipo de cambio de Banguat fuera de rango plausible: ${match[1]}`)
    }

    return rate
}

async function fetchRateFromBanguat(): Promise<number> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), env.exchangeRateFetchTimeoutMs)

    try {
        const response = await fetch(env.banguatExchangeRateUrl, {
            signal: controller.signal,
            headers: { Accept: "text/xml, application/xml" },
        })

        if (!response.ok) {
            throw new Error(`Banguat respondió con status ${response.status}`)
        }

        const xml = await response.text()
        return extractVentaRate(xml)
    } finally {
        clearTimeout(timeoutId)
    }
}

// Refresca el cache -- si ya hay un refresh en vuelo, reusa esa misma promesa en vez de
// disparar otro fetch (single-flight, ver comentario de diseño (5) arriba).
function refreshCache(): Promise<number> {
    if (inFlightRefresh) return inFlightRefresh

    inFlightRefresh = fetchRateFromBanguat()
        .then(rate => {
            cache = { rate, fetchedAt: Date.now() }
            return rate
        })
        .finally(() => {
            inFlightRefresh = null
        })

    return inFlightRefresh
}

// Punto único de lectura del tipo de cambio USD->GTQ para el resto del backend.
// - Cache fresco -> se devuelve directo, sin tocar la red.
// - Cache vencido o inexistente -> intenta refrescar contra Banguat; si falla y hay un valor
//   cacheado previo (aunque esté vencido), se usa ese como fallback (con un warning) en vez de
//   romper el cálculo de la cotización.
// - Sin cache ninguno (arranque en frío) y falla el fetch -> no hay ningún valor confiable que
//   devolver: se propaga el error para que quien llama decida cómo manejarlo (no se inventa un
//   número por defecto para dinero real).
export async function getUsdToGtqRate(): Promise<number> {
    if (isCacheFresh(cache)) return cache.rate

    try {
        return await refreshCache()
    } catch (error) {
        const cachedRate = getCachedRate()
        if (cachedRate !== null) {
            console.warn(
                "[exchangeRate] No se pudo refrescar el tipo de cambio de Banguat, se usa el último valor cacheado:",
                error
            )
            return cachedRate
        }

        console.error(
            "[exchangeRate] No se pudo obtener el tipo de cambio de Banguat y no hay ningún valor cacheado previo:",
            error
        )
        throw error
    }
}

// Solo para tests -- resetea el estado interno del módulo entre pruebas (cache + refresh en
// vuelo), ya que ambos viven en variables de módulo compartidas entre llamadas.
export function __resetExchangeRateCacheForTests(): void {
    cache = null
    inFlightRefresh = null
}
