jest.mock("../../config/env", () => ({
    env: {
        banguatExchangeRateUrl: "https://www.banguat.gob.gt/variables/ws/TipoCambio.asmx/TipoCambioDia",
        exchangeRateCacheTtlMs: 1000,
        exchangeRateFetchTimeoutMs: 500,
    },
}))

import { getUsdToGtqRate, __resetExchangeRateCacheForTests } from "./exchangeRate.service"

const VALID_XML = `<?xml version="1.0" encoding="utf-8"?>
<CambioDolar>
  <VarDolar>
    <fecha>01/09/2026</fecha>
    <referencia>0</referencia>
    <compra>7.75000</compra>
    <venta>7.80000</venta>
  </VarDolar>
</CambioDolar>`

function fakeFetch(implementation: (...args: unknown[]) => Promise<unknown>): void {
    global.fetch = jest.fn(implementation) as unknown as typeof fetch
}

function jsonOkResponse(xml: string, ok = true, status = 200) {
    return {
        ok,
        status,
        text: async () => xml,
    }
}

describe("getUsdToGtqRate", () => {
    beforeEach(() => {
        __resetExchangeRateCacheForTests()
        jest.restoreAllMocks()
    })

    it("extrae y devuelve el valor de <venta> de una respuesta válida de Banguat", async () => {
        fakeFetch(async () => jsonOkResponse(VALID_XML))

        const rate = await getUsdToGtqRate()

        expect(rate).toBe(7.8)
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it("sirve desde cache sin volver a llamar a Banguat mientras el cache siga fresco", async () => {
        fakeFetch(async () => jsonOkResponse(VALID_XML))

        await getUsdToGtqRate()
        await getUsdToGtqRate()
        await getUsdToGtqRate()

        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it("refresca contra Banguat una vez que el cache vence", async () => {
        fakeFetch(async () => jsonOkResponse(VALID_XML))

        await getUsdToGtqRate()
        // exchangeRateCacheTtlMs = 1000 en el mock -- se fuerza el vencimiento manipulando el
        // tiempo real transcurrido en vez de usar fake timers (mantiene el test simple, ver
        // sleep helper abajo).
        await new Promise(resolve => setTimeout(resolve, 1100))

        await getUsdToGtqRate()

        expect(fetch).toHaveBeenCalledTimes(2)
    }, 10000)

    it("dispara un solo fetch a Banguat aunque lleguen varias peticiones concurrentes (single-flight)", async () => {
        let resolveText: (xml: string) => void
        const pendingText = new Promise<string>(resolve => {
            resolveText = resolve
        })
        fakeFetch(async () => ({ ok: true, status: 200, text: () => pendingText }))

        const results = Promise.all([getUsdToGtqRate(), getUsdToGtqRate(), getUsdToGtqRate()])
        resolveText!(VALID_XML)
        const rates = await results

        expect(rates).toEqual([7.8, 7.8, 7.8])
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it("cae al último valor cacheado si Banguat falla después de tener un valor válido", async () => {
        fakeFetch(async () => jsonOkResponse(VALID_XML))
        await getUsdToGtqRate()
        await new Promise(resolve => setTimeout(resolve, 1100))

        fakeFetch(async () => {
            throw new Error("network error")
        })
        const rate = await getUsdToGtqRate()

        expect(rate).toBe(7.8)
    }, 10000)

    it("propaga el error si Banguat falla y nunca hubo un valor cacheado (arranque en frío)", async () => {
        fakeFetch(async () => {
            throw new Error("network error")
        })

        await expect(getUsdToGtqRate()).rejects.toThrow("network error")
    })

    it("rechaza una respuesta sin <venta> dentro de <CambioDolar> (formato inesperado)", async () => {
        fakeFetch(async () => jsonOkResponse("<CambioDolar><VarDolar><fecha>01/09/2026</fecha></VarDolar></CambioDolar>"))

        await expect(getUsdToGtqRate()).rejects.toThrow("no se encontró <venta>")
    })

    it("no matchea un intento de XXE (<!ENTITY>) -- se trata como formato inesperado, no se resuelve nada", async () => {
        const xxeAttempt = `<?xml version="1.0"?>
<!DOCTYPE CambioDolar [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<CambioDolar><VarDolar><venta>&xxe;</venta></VarDolar></CambioDolar>`
        fakeFetch(async () => jsonOkResponse(xxeAttempt))

        await expect(getUsdToGtqRate()).rejects.toThrow("no se encontró <venta>")
    })

    it("rechaza un valor de <venta> fuera del rango plausible", async () => {
        fakeFetch(async () =>
            jsonOkResponse("<CambioDolar><VarDolar><venta>999999</venta></VarDolar></CambioDolar>")
        )

        await expect(getUsdToGtqRate()).rejects.toThrow("fuera de rango plausible")
    })

    it("rechaza una respuesta HTTP no exitosa", async () => {
        fakeFetch(async () => jsonOkResponse(VALID_XML, false, 503))

        await expect(getUsdToGtqRate()).rejects.toThrow("status 503")
    })
})
