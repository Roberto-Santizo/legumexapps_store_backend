import { Table, Column, DataType, ForeignKey, BelongsTo, Model } from "sequelize-typescript";
import Salesperson from "../../salesperson/models/Salesperson.model";
import SubCategory from "../../category/models/SubCategory.model";
import Presentation from "../../presentation/models/Presentation.model";
import Destination from "../../destination/models/Destination.model";

// Cotización a la medida guardada (World 2): un producto que NO existe (sin SKU, sin Cliente) que un
// representante armó y quiere cotizar. Tabla APARTE de `quotes` a propósito, igual que quoteDrafts:
// ni el dashboard, ni listAllQuotes, ni QuoteDraft la leen, así que datos incompletos nunca se mezclan
// con cotizaciones de productos definidos. Pertenece solo al representante del JWT (sin Cliente).
// Congela, como Quote, el desglose completo (`breakdown`, misma forma que Quote.breakdown) + columnas
// sueltas para listar sin parsear JSON, y además la `configuration` (lo elegido + las cantidades
// resueltas por nivel) para que el admin pueda reproducir/fabricar el producto sin volver a leer las
// listas de permitidos, que pueden cambiar después.
// status: seguimiento del admin. new = recién llegada; reviewed = vista; in_development = se va a
// fabricar / convertir en producto; discarded = descartada. Se puede pasar de cualquiera a cualquiera.
export const CUSTOM_QUOTE_STATUSES = ["new", "reviewed", "in_development", "discarded"] as const;
export type CustomQuoteStatus = typeof CUSTOM_QUOTE_STATUSES[number];

const MONEY = DataType.DECIMAL(12, 4);

@Table({
    tableName: "customQuotes"
})
class CustomQuote extends Model {
    @ForeignKey(() => Salesperson)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare salespersonId: number

    @ForeignKey(() => SubCategory)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare subCategoryId: number

    @ForeignKey(() => Presentation)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare presentationId: number

    // null = sin destino (transporte $0), mismo criterio que Quote.destinationId.
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
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false
    })
    declare isOrganic: boolean

    @Column({ type: DataType.INTEGER, allowNull: false })
    declare requestedPallets: number

    @Column({ type: DataType.INTEGER, allowNull: false })
    declare totalUnits: number

    // Composición de palet con la que se cotizó (copiada de customQuotePresentationOptions al guardar).
    @Column({ type: DataType.INTEGER, allowNull: false })
    declare boxesPerPallet: number

    @Column({ type: DataType.INTEGER, allowNull: false })
    declare bagsPerBox: number

    @Column({ type: DataType.INTEGER, allowNull: true })
    declare unitsPerIntermediatePackage: number | null

    @Column({ type: MONEY, allowNull: false })
    declare rawMaterialCost: number

    @Column({ type: MONEY, allowNull: false })
    declare ingredientCost: number

    @Column({ type: MONEY, allowNull: false })
    declare unitPackagingCost: number

    @Column({ type: MONEY, allowNull: false })
    declare intermediatePackagingCost: number

    @Column({ type: MONEY, allowNull: false })
    declare processingCostTotal: number

    @Column({ type: MONEY, allowNull: false })
    declare palletMaterialCost: number

    @Column({ type: MONEY, allowNull: false })
    declare percentageCostTotal: number

    @Column({ type: MONEY, allowNull: false })
    declare transportCost: number

    @Column({ type: MONEY, allowNull: false })
    declare adjustmentCost: number

    @Column({ type: MONEY, allowNull: false })
    declare totalCost: number

    @Column({
        type: DataType.JSONB,
        allowNull: false
    })
    declare configuration: object

    @Column({
        type: DataType.JSONB,
        allowNull: false
    })
    declare breakdown: object

    @Column({
        type: DataType.ENUM(...CUSTOM_QUOTE_STATUSES),
        allowNull: false,
        defaultValue: "new"
    })
    declare status: CustomQuoteStatus

    @BelongsTo(() => Salesperson, "salespersonId")
    declare requestingSalesperson: Salesperson

    @BelongsTo(() => SubCategory, "subCategoryId")
    declare subCategory: SubCategory

    @BelongsTo(() => Presentation, "presentationId")
    declare presentation: Presentation

    @BelongsTo(() => Destination, "destinationId")
    declare destination: Destination | null
}

export default CustomQuote;
