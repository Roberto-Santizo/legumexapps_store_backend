// DECIMAL values arrive from PostgreSQL as strings. Cast at the DTO boundary,
// including nested juice catalogs; keep null overrides as null (inheritance).
const NUMERIC_FIELDS = new Set([
    "accesorialPerContainer",
    "bottleUnitCost",
    "bottlesPerCase",
    "boxUnitCost",
    "capUnitCost",
    "casesPerPallet",
    "cleaningPerPound",
    "clientId",
    "costPerGram",
    "costPerLiter",
    "costPerUnit",
    "directLaborPerPound",
    "distributorCommissionRate",
    "electricityPerPound",
    "financialPerPound",
    "fixedPerPound",
    "freightPerContainer",
    "gramsPerLiter",
    "hppPerPound",
    "inOutPerContainer",
    "indirectLaborPerPound",
    "juiceId",
    "laboratoryPerPound",
    "localCustomsPerContainer",
    "logisticMovementPerContainer",
    "marginPerCase",
    "miamiCustomsPerContainer",
    "mlPerBottle",
    "palletizingPerContainer",
    "palletsPerContainer",
    "percentage",
    "portFeeRate",
    "pricePerPound",
    "rawMaterialId",
    "salesmanCommissionRate",
    "secondStickerQuantityPerCase",
    "secondStickerUnitCost",
    "spiceMaterialId",
    "stickerQuantityPerCase",
    "stickerUnitCost",
    "storagePerContainer",
    "tariffRate",
    "unexpectedRate",
    "yieldPoundsPerLiter",
    "id",
    "revision",
])

export function juiceDto(value: unknown): unknown {
    if (value === null || typeof value !== "object" || value instanceof Date) return value
    if (Array.isArray(value)) return value.map(juiceDto)
    const object = value as Record<string, unknown> & { toJSON?: () => unknown }
    if (typeof object.toJSON === "function") return juiceDto(object.toJSON())
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [
        key, NUMERIC_FIELDS.has(key) && item !== null && item !== undefined ? Number(item) : juiceDto(item)
    ]))
}
