import { Table, Column, DataType, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Product from "../../product/models/Product.model";

@Table({
    tableName: "productTypes"
})
class ProductType extends BaseCatalogModel {
    @Column({
        type: DataType.STRING(40),
        allowNull: false,
        unique: true
    })
    declare typeCode: string

    @Column({
        type: DataType.STRING(80),
        allowNull: false
    })
    declare displayName: string

    @HasMany(() => Product, "productTypeId")
    declare typedProducts: Product[]
}

export default ProductType;
