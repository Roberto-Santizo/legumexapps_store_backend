import { UniqueConstraintError } from "sequelize"
import QuoteDraft from "../models/QuoteDraft.model"
import Salesperson from "../../salesperson/models/Salesperson.model"
import { DRAFT_ABANDONED_AFTER_HOURS } from "../constants/quoteDraft.constant"
import { businessDayRangeFilter } from "../../../shared/utils/businessTime.util"

const MS_PER_HOUR = 60 * 60 * 1000

// Solo lo que el borrador congela de un QuoteCalculation (quote.service.ts) -- tipo estructural para
// no acoplar este módulo al motor: cualquier resultado de calculateQuote lo cumple.
export interface DraftCalculation {
    productVariantId: number
    productDisplayName: string
    variantLabel: string | null
    requestedPallets: number
    totalCost: number
    breakdown: object
}

interface MaterialSnapshotLine {
    displayName: string
    optionGroup: string | null
}

interface DraftBreakdownSnapshot {
    unitMaterials?: MaterialSnapshotLine[]
    intermediateMaterials?: MaterialSnapshotLine[]
    palletMaterials?: MaterialSnapshotLine[]
}

export type QuoteDraftState = "in_progress" | "abandoned"

export interface QuoteDraftListItem {
    id: number
    salesperson: { id: number; name: string; companyName: string | null; email: string } | null
    productVariantId: number
    productDisplayName: string
    variantLabel: string | null
    requestedPallets: number
    totalCost: number
    // Solo nombres de materiales costeados, misma forma que Quote.breakdown -- el frontend la pasa por
    // buildPackagingConfiguration (el mismo helper que el PDF).
    packaging: {
        unitMaterials: MaterialSnapshotLine[]
        intermediateMaterials: MaterialSnapshotLine[]
        palletMaterials: MaterialSnapshotLine[]
    }
    previewCount: number
    startedAt: Date
    lastActivityAt: Date
    state: QuoteDraftState
}

function buildSnapshot(input: object, calculation: DraftCalculation) {
    return {
        productVariantId: calculation.productVariantId,
        productDisplayName: calculation.productDisplayName,
        variantLabel: calculation.variantLabel,
        requestedPallets: calculation.requestedPallets,
        totalCost: calculation.totalCost,
        input,
        breakdown: calculation.breakdown,
    }
}

async function updateExistingDraft(draft: QuoteDraft, snapshot: ReturnType<typeof buildSnapshot>): Promise<void> {
    // Un preview tardío después de guardar NO reabre el borrador convertido.
    if (draft.status !== "in_progress") return
    await draft.update({ ...snapshot, previewCount: draft.previewCount + 1 })
}

// Llamado SOLO por el preview del representante, después de un calculateQuote exitoso. Inserta el
// borrador la primera vez (previewCount 1) o actualiza el mismo (salespersonId, draftKey) con el último
// cálculo (previewCount + 1). Nunca toca Quote.
async function upsertFromCalculation(
    salespersonId: number,
    draftKey: string,
    input: object,
    calculation: DraftCalculation
): Promise<void> {
    const snapshot = buildSnapshot(input, calculation)
    const existing = await QuoteDraft.findOne({ where: { salespersonId, draftKey } })
    if (existing) {
        await updateExistingDraft(existing, snapshot)
        return
    }

    try {
        await QuoteDraft.create({ salespersonId, draftKey, ...snapshot, previewCount: 1, status: "in_progress" })
    } catch (error) {
        // Dos previews simultáneos del mismo intento: el otro ya insertó la fila (índice único) --
        // se trata como una actualización más.
        if (!(error instanceof UniqueConstraintError)) throw error
        const created = await QuoteDraft.findOne({ where: { salespersonId, draftKey } })
        if (created) await updateExistingDraft(created, snapshot)
    }
}

// Llamado por saveQuote DESPUÉS del Quote.create. Una clave desconocida o de otro representante no
// matchea ninguna fila: no-op.
async function markConverted(draftKey: string, salespersonId: number, convertedQuoteId: number): Promise<void> {
    await QuoteDraft.update(
        { status: "converted", convertedQuoteId },
        { where: { salespersonId, draftKey, status: "in_progress" } }
    )
}

function resolveDraftState(lastActivityAt: Date, now: Date): QuoteDraftState {
    const elapsedMs = now.getTime() - lastActivityAt.getTime()
    return elapsedMs >= DRAFT_ABANDONED_AFTER_HOURS * MS_PER_HOUR ? "abandoned" : "in_progress"
}

// Seguimiento admin: solo borradores in_progress (las convertidas se ocultan), más reciente primero.
// El rango opcional filtra por última actividad (updatedAt); startDate/endDate son días "YYYY-MM-DD"
// en hora de Guatemala (mismos límites de día que el dashboard).
async function listDrafts(startDate?: string, endDate?: string, now: Date = new Date()): Promise<QuoteDraftListItem[]> {
    const updatedAtFilter = businessDayRangeFilter(startDate, endDate)

    const drafts = await QuoteDraft.findAll({
        where: {
            status: "in_progress",
            ...(updatedAtFilter ? { updatedAt: updatedAtFilter } : {}),
        },
        include: [
            { model: Salesperson, as: "draftingSalesperson", attributes: ["id", "name", "companyName", "email"] }
        ],
        order: [["updatedAt", "DESC"]],
    })

    return drafts
        // Defensa extra: aunque el where ya filtra, una convertida nunca debe llegar al listado.
        .filter(draft => draft.status === "in_progress")
        .map(draft => {
            const breakdown = (draft.breakdown ?? {}) as DraftBreakdownSnapshot
            const startedAt = new Date(draft.get("createdAt") as Date)
            const lastActivityAt = new Date(draft.get("updatedAt") as Date)
            const salesperson = draft.draftingSalesperson
            return {
                id: draft.id,
                salesperson: salesperson
                    ? { id: salesperson.id, name: salesperson.name, companyName: salesperson.companyName ?? null, email: salesperson.email }
                    : null,
                productVariantId: draft.productVariantId,
                productDisplayName: draft.productDisplayName,
                variantLabel: draft.variantLabel,
                requestedPallets: Number(draft.requestedPallets),
                totalCost: Number(draft.totalCost),
                packaging: {
                    unitMaterials: breakdown.unitMaterials ?? [],
                    intermediateMaterials: breakdown.intermediateMaterials ?? [],
                    palletMaterials: breakdown.palletMaterials ?? [],
                },
                previewCount: Number(draft.previewCount),
                startedAt,
                lastActivityAt,
                state: resolveDraftState(lastActivityAt, now),
            }
        })
}

export const quoteDraftService = {
    upsertFromCalculation,
    markConverted,
    listDrafts,
}
