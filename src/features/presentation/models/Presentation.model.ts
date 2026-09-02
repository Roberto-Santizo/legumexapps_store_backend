import { Table, Column, DataType, ForeignKey, BelongsTo, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Category from "../../category/models/Category.model";
import ProductVariant from "../../product/models/ProductVariant.model";

@Table({
    tableName: "presentations"
})
class Presentation extends BaseCatalogModel {
    @Column({
        type: DataType.STRING(40),
        allowNull: false
    })
    declare displayLabel: string

    @Column({
        type: DataType.DECIMAL(10, 2),
        allowNull: true
    })
    declare netWeightGrams: number

    @ForeignKey(() => Category)
    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare categoryId: number

    @BelongsTo(() => Category, "categoryId")
    declare linkedCategory: Category

    @HasMany(() => ProductVariant, "presentationId")
    declare sizedVariants: ProductVariant[]
}

export default Presentation;
