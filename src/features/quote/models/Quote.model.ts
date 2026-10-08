import { Table, Column, DataType, ForeignKey, BelongsTo, Model } from "sequelize-typescript";
import Salesperson from "../../salesperson/models/Salesperson.model";
import ProductVariant from "../../product/models/ProductVariant.model";
import Destination from "../../destination/models/Destination.model";

@Table({
    tableName: "quotes"
})
class Quote extends Model {
    // La columna física sigue llamándose "customerId": field explícito para que sequelize-typescript no
    // infiera "salespersonId" como nombre de columna.
    @ForeignKey(() => Salesperson)
    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        field: "customerId"
    })
    declare salespersonId: number

    @ForeignKey(() => ProductVariant)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare productVariantId: number

    // allowNull: transporte apagado temporalmente, así que una Quote puede quedar sin destino.
    // Reversible: volver a allowNull:false cuando se reactive el transporte.
    @ForeignKey(() => Destination)
    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare destinationId: number | null

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

    // Ingredientes agregados (sal, azúcar...): línea aparte de rawMaterialCost. defaultValue 0: una
    // cotización sin ingredientes vale 0, nunca NULL.
    @Column({
        type: DataType.DECIMAL(12, 4),
        allowNull: false,
        defaultValue: 0
    })
    declare ingredientCost: number

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

    // defaultValue 0: sin default, sync({ alter: true }) dejaría las filas existentes con NULL en una
    // columna NOT NULL.
    @Column({
        type: DataType.DECIMAL(12, 4),
        allowNull: false,
        defaultValue: 0
    })
    declare processingCostTotal: number

    // defaultValue 0: sin default, sync({ alter: true }) dejaría las filas existentes con NULL en una
    // columna NOT NULL.
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

    @BelongsTo(() => Salesperson, "salespersonId")
    declare quotingSalesperson: Salesperson

    @BelongsTo(() => ProductVariant, "productVariantId")
    declare quotedVariant: ProductVariant

    @BelongsTo(() => Destination, "destinationId")
    declare quotedDestination: Destination
}

export default Quote;
