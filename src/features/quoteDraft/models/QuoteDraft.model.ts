import { Table, Column, DataType, ForeignKey, BelongsTo, Model } from "sequelize-typescript";
import Salesperson from "../../salesperson/models/Salesperson.model";
import ProductVariant from "../../product/models/ProductVariant.model";
import Quote from "../../quote/models/Quote.model";

// Cotización sin finalizar: lo último que calculó un representante en el wizard (POST /quotes/preview)
// antes de guardar. Tabla APARTE de `quotes` a propósito -- ni saveQuote, ni listAllQuotes, ni el
// dashboard la leen, así que un borrador nunca puede colarse en las métricas de demanda. Se
// identifica por (salespersonId, draftKey): draftKey es un UUID que genera el frontend por intento de
// cotización, y el servidor SIEMPRE lo acota al representante del JWT.
// "Abandonada" no es un status guardado: se deriva al leer (in_progress + updatedAt > 24h, ver
// quoteDraft.constant.ts). Las convertidas se conservan (ratio de conversión futuro), el listado las oculta.
export const QUOTE_DRAFT_STATUSES = ["in_progress", "converted"] as const;
export type QuoteDraftStatus = typeof QUOTE_DRAFT_STATUSES[number];

@Table({
    tableName: "quoteDrafts",
    indexes: [
        {
            unique: true,
            fields: ["salespersonId", "draftKey"]
        }
    ]
})
class QuoteDraft extends Model {
    @ForeignKey(() => Salesperson)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare salespersonId: number

    @Column({
        type: DataType.UUID,
        allowNull: false
    })
    declare draftKey: string

    @ForeignKey(() => ProductVariant)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare productVariantId: number

    @Column({
        type: DataType.STRING(150),
        allowNull: false
    })
    declare productDisplayName: string

    @Column({
        type: DataType.STRING(150),
        allowNull: true
    })
    declare variantLabel: string | null

    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare requestedPallets: number

    @Column({
        type: DataType.DECIMAL(12, 4),
        allowNull: false
    })
    declare totalCost: number

    // Lo que mandó el wizard (CalculateQuoteInput sin el draftKey): SKU, palets, selecciones de materiales.
    @Column({
        type: DataType.JSONB,
        allowNull: false
    })
    declare input: object

    // Mismo snapshot que Quote.breakdown, del último cálculo exitoso.
    @Column({
        type: DataType.JSONB,
        allowNull: false
    })
    declare breakdown: object

    // Cuántas veces se recalculó (1 al crear, +1 por cada preview posterior).
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        defaultValue: 1
    })
    declare previewCount: number

    @Column({
        type: DataType.ENUM(...QUOTE_DRAFT_STATUSES),
        allowNull: false,
        defaultValue: "in_progress"
    })
    declare status: QuoteDraftStatus

    @ForeignKey(() => Quote)
    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare convertedQuoteId: number | null

    @BelongsTo(() => Salesperson, "salespersonId")
    declare draftingSalesperson: Salesperson

    @BelongsTo(() => ProductVariant, "productVariantId")
    declare draftedVariant: ProductVariant

    @BelongsTo(() => Quote, "convertedQuoteId")
    declare convertedQuote: Quote | null
}

export default QuoteDraft;
