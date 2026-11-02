import CustomQuote, { CustomQuoteStatus } from "../models/CustomQuote.model"
import Salesperson from "../../salesperson/models/Salesperson.model"
import { NotFoundError } from "../../../shared/errors/AppError"
import { businessDayRangeFilter } from "../../../shared/utils/businessTime.util"
import { ContentLanguage, DEFAULT_CONTENT_LANGUAGE } from "../../../shared/utils/translation.util"
import { approvedQuoteProfits } from "../../quoteReview/services/approvedQuoteProfits"
import type { ApprovedQuoteProfit } from "../../quoteReview/services/approvedQuoteProfits"
import { Op } from "sequelize"
import type { calculateCatalogQuote } from "./catalogQuote.service"
type NewCatalogSnapshot = Awaited<ReturnType<typeof calculateCatalogQuote>>["configuration"]["snapshot"]
type CatalogSnapshot = Omit<NewCatalogSnapshot, "schemaVersion" | "source"> & { schemaVersion: 2 | 3; source: { productVariantId: number; skuCode: string; configurationFingerprint: string } | NewCatalogSnapshot["source"] }
function snapshotOf(quote: CustomQuote): CatalogSnapshot | undefined {
    const configuration = quote.configuration as { snapshot?: CatalogSnapshot }
    return (configuration.snapshot?.schemaVersion === 2 || configuration.snapshot?.schemaVersion === 3) ? configuration.snapshot : undefined
}

// Lectura admin de cotizaciones a la medida (solo customQuotes -- nunca Quote ni el dashboard) y el
// cambio de estado del seguimiento. DECIMALs casteados a número en el borde del DTO.

const MONEY_FIELDS = [
    "rawMaterialCost",
    "ingredientCost",
    "unitPackagingCost",
    "intermediatePackagingCost",
    "processingCostTotal",
    "palletMaterialCost",
    "percentageCostTotal",
    "transportCost",
    "adjustmentCost",
    "totalCost",
] as const

type MoneyField = (typeof MONEY_FIELDS)[number]

interface SalespersonSummary {
    id: number
    name: string
    companyName: string | null
    email: string
}

interface CustomQuoteListItem {
    id: number
    status: CustomQuoteStatus
    createdAt: Date
    updatedAt: Date
    salesperson: SalespersonSummary | null
    subCategoryId: number
    subCategoryName: string | null
    presentationId: number
    presentationLabel: string | null
    productDisplayName: string
    variantLabel: string | null
    requestedPallets: number
    totalUnits: number
    totalCost: number
    // Ganancia y precio final aprobados por gerencia; null si el pedido aún no se aprueba.
    profit: ApprovedQuoteProfit | null
}

type CustomQuoteDetail = CustomQuoteListItem & Record<MoneyField, number> & {
    destinationId: number | null
    destinationName: string | null
    boxesPerPallet: number
    bagsPerBox: number
    unitsPerIntermediatePackage: number | null
    configuration: object
    breakdown: object
}

const LIST_INCLUDE = [
    { model: Salesperson, as: "requestingSalesperson", attributes: ["id", "name", "companyName", "email"] },
]

const DETAIL_INCLUDE = [
    ...LIST_INCLUDE,
]

function toListItem(customQuote: CustomQuote, language: ContentLanguage, profit: ApprovedQuoteProfit | null): CustomQuoteListItem {
    const salesperson = customQuote.requestingSalesperson
    return {
        id: customQuote.id,
        status: customQuote.status,
        createdAt: customQuote.get("createdAt") as Date,
        updatedAt: customQuote.get("updatedAt") as Date,
        salesperson: salesperson
            ? { id: salesperson.id, name: salesperson.name, companyName: salesperson.companyName ?? null, email: salesperson.email }
            : null,
        subCategoryId: customQuote.subCategoryId,
        subCategoryName: snapshotOf(customQuote)?.subCategory.displayName ?? null,
        presentationId: customQuote.presentationId,
        presentationLabel: snapshotOf(customQuote)?.presentation.displayLabel ?? customQuote.variantLabel ?? null,
        productDisplayName: customQuote.productDisplayName,
        variantLabel: customQuote.variantLabel,
        requestedPallets: Number(customQuote.requestedPallets),
        totalUnits: Number(customQuote.totalUnits),
        totalCost: Number(customQuote.totalCost),
        profit,
    }
}

function toDetail(customQuote: CustomQuote, language: ContentLanguage, profit: ApprovedQuoteProfit | null): CustomQuoteDetail {
    const money = Object.fromEntries(MONEY_FIELDS.map(field => [field, Number(customQuote[field])])) as Record<MoneyField, number>
    return {
        ...toListItem(customQuote, language, profit),
        ...money,
        destinationId: customQuote.destinationId ?? null,
        destinationName: (customQuote.breakdown as { transport?: { displayName?: string } }).transport?.displayName ?? null,
        boxesPerPallet: Number(customQuote.boxesPerPallet),
        bagsPerBox: Number(customQuote.bagsPerBox),
        unitsPerIntermediatePackage:
            customQuote.unitsPerIntermediatePackage === null || customQuote.unitsPerIntermediatePackage === undefined
                ? null
                : Number(customQuote.unitsPerIntermediatePackage),
        configuration: customQuote.configuration,
        breakdown: customQuote.breakdown,
    }
}

// Más reciente primero. Solo las líneas con precio final aprobado por gerencia (las anteriores a la
// revisión gerencial no aparecen). Rango opcional sobre createdAt (días de Guatemala) y filtro opcional por estado.
async function listCustomQuotes(
    filters: { startDate?: string; endDate?: string; status?: CustomQuoteStatus } = {},
    language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE
): Promise<CustomQuoteListItem[]> {
    const createdAtFilter = businessDayRangeFilter(filters.startDate, filters.endDate)
    const profits = await approvedQuoteProfits("customizable")
    if (profits.size === 0) return []
    const customQuotes = await CustomQuote.findAll({
        where: {
            id: { [Op.in]: [...profits.keys()] },
            ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
            ...(filters.status ? { status: filters.status } : {}),
        },
        include: LIST_INCLUDE,
        order: [["createdAt", "DESC"]],
    })
    return customQuotes.map(customQuote => toListItem(customQuote, language, profits.get(customQuote.id)!))
}

async function getCustomQuoteById(id: number, language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE): Promise<CustomQuoteDetail> {
    const customQuote = await CustomQuote.findOne({ where: { id }, include: DETAIL_INCLUDE })
    if (!customQuote) throw new NotFoundError("CustomQuote", id)
    // Solo la revisión de su pedido; sin pedido (registros antiguos) no hay precio aprobado.
    const orderId = (customQuote.breakdown as { order?: { id?: unknown } } | null)?.order?.id
    const profits = typeof orderId === "string" ? await approvedQuoteProfits("customizable", orderId) : new Map<number, ApprovedQuoteProfit>()
    return toDetail(customQuote, language, profits.get(customQuote.id) ?? null)
}

// Solo el estado del seguimiento: el desglose y la configuración congelados nunca se editan.
async function setCustomQuoteStatus(
    id: number,
    status: CustomQuoteStatus
): Promise<{ id: number; status: CustomQuoteStatus }> {
    const customQuote = await CustomQuote.findOne({ where: { id } })
    if (!customQuote) throw new NotFoundError("CustomQuote", id)
    await customQuote.update({ status })
    return { id: customQuote.id, status }
}

export const adminCustomQuoteService = {
    listCustomQuotes,
    getCustomQuoteById,
    setCustomQuoteStatus,
}
