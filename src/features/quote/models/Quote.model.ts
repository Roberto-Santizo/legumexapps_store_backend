import { Table, Column, DataType, ForeignKey, BelongsTo, Model } from "sequelize-typescript";
import Customer from "../../customer/models/Customer.model";
import ProductVariant from "../../product/models/ProductVariant.model";
import Destination from "../../destination/models/Destination.model";

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

    @ForeignKey(() => Destination)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare destinationId: number

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

    // Ver Product.model.ts::additionalCostPerUnit -- mismo patrón que intermediatePackagingCost
    // (columna agregada después, defaultValue 0 para no romper filas viejas).
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
}

export default Quote;
