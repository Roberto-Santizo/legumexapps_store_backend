import { Table, Column, DataType, ForeignKey, BelongsTo, Model } from "sequelize-typescript";
import Product from "./Product.model";

@Table({
    tableName: "productTranslations",
    indexes: [
        {
            unique: true,
            fields: ["productId", "language"]
        }
    ]
})
class ProductTranslation extends Model {
    @ForeignKey(() => Product)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare productId: number

    @Column({
        type: DataType.STRING(5),
        allowNull: false
    })
    declare language: string

    @Column({
        type: DataType.STRING(120),
        allowNull: false
    })
    declare displayName: string

    @BelongsTo(() => Product, "productId")
    declare parentProduct: Product
}

export default ProductTranslation;
