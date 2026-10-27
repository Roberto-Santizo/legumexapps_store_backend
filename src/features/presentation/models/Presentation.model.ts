import { Table, Column, DataType, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import ProductVariant from "../../product/models/ProductVariant.model";

@Table({
    tableName: "presentations"
})
class Presentation extends BaseCatalogModel {
    @Column({
        type: DataType.DECIMAL(14, 3),
        allowNull: true
    })
    declare netVolumeMl: number | null

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

    @HasMany(() => ProductVariant, "presentationId")
    declare sizedVariants: ProductVariant[]
}

export default Presentation;
