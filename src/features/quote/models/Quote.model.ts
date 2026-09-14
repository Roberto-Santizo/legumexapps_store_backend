import { Table, Column, DataType, ForeignKey, BelongsTo, Model } from "sequelize-typescript";
import Customer from "../../customer/models/Customer.model";
import ProductVariant from "../../product/models/ProductVariant.model";
import Destination from "../../destination/models/Destination.model";
import Lead from "../../lead/models/Lead.model";

@Table({
    tableName: "quotes"
})
class Quote extends Model {
    @ForeignKey(() => Customer)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare customerId: number

    @ForeignKey(() => ProductVariant)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare productVariantId: number

    // allowNull: true (2026-09-10) -- transporte "apagado" temporalmente para el cliente: ya no
    // elige destino, así que una Quote puede quedar sin destinationId. Solo se relaja la
    // restricción NOT NULL (sequelize.sync({alter}) altera la columna en Postgres, no borra
    // datos existentes) -- las cotizaciones viejas guardadas con destino siguen intactas.
    // Trivialmente reversible: volver a allowNull:false cuando se reactive transporte.
    @ForeignKey(() => Destination)
    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare destinationId: number | null

    // Prospecto (Lead) al que se registra esta cotización (2026-09-13) -- columna NUEVA, nullable
    // (sequelize.sync la agrega sola, sin SQL manual). Nullable a propósito: es opcional por
    // diseño para no reventar si algún día se guarda una Quote sin pasar por
    // quoteService.saveQuote (ej. un import futuro), y para que cotizaciones YA guardadas antes
    // de este cambio simplemente queden con leadId: null en vez de romper. Se resuelve siempre
    // (create-or-reuse por email, ver leadService.findOrCreateLeadForQuote) desde
    // quoteController.save -- la única vía real de creación de Quote hoy.
    @ForeignKey(() => Lead)
    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare leadId: number | null

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
        type: DataType.INTEGER,
        allowNull: false
    })
    declare totalUnits: number

    @Column({
        type: DataType.DECIMAL(12, 4),
        allowNull: false
    })
    declare rawMaterialCost: number

    @Column({
        type: DataType.DECIMAL(12, 4),
        allowNull: false
    })
    declare unitPackagingCost: number

    @Column({
        type: DataType.DECIMAL(12, 4),
        allowNull: false,
        defaultValue: 0
    })
    declare intermediatePackagingCost: number

    // defaultValue: 0 -- se agregó con cotizaciones ya existentes en la BD, mismo motivo que
    // intermediatePackagingCost/adjustmentCost arriba: sin default, sync({alter:true}) dejaría
    // esas filas viejas con NULL en una columna NOT NULL.
    @Column({
        type: DataType.DECIMAL(12, 4),
        allowNull: false,
        defaultValue: 0
    })
    declare processingCostTotal: number

    // defaultValue: 0 -- mismo motivo que processingCostTotal arriba: se agrega con cotizaciones
    // ya existentes en la BD, sin default sync({alter:true}) dejaría esas filas viejas con NULL
    // en una columna NOT NULL.
    @Column({
        type: DataType.DECIMAL(12, 4),
        allowNull: false,
        defaultValue: 0
    })
    declare percentageCostTotal: number

    @Column({
        type: DataType.DECIMAL(12, 4),
        allowNull: false
    })
    declare palletMaterialCost: number

    @Column({
        type: DataType.DECIMAL(12, 4),
        allowNull: false
    })
    declare transportCost: number

    @Column({
        type: DataType.DECIMAL(12, 4),
        allowNull: false,
        defaultValue: 0
    })
    declare adjustmentCost: number

    @Column({
        type: DataType.DECIMAL(12, 4),
        allowNull: false
    })
    declare totalCost: number

    @Column({
        type: DataType.JSONB,
        allowNull: false
    })
    declare breakdown: object

    @BelongsTo(() => Customer, "customerId")
    declare quotingCustomer: Customer

    @BelongsTo(() => ProductVariant, "productVariantId")
    declare quotedVariant: ProductVariant

    @BelongsTo(() => Destination, "destinationId")
    declare quotedDestination: Destination

    @BelongsTo(() => Lead, "leadId")
    declare quotedLead: Lead
}

export default Quote;
