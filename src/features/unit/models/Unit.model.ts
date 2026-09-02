import { Table, Column, DataType, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Ingredient from "../../ingredient/models/Ingredient.model";
import ProductIngredient from "../../product/models/ProductIngredient.model";

@Table({
    tableName: "units"
})
class Unit extends BaseCatalogModel {
    @Column({
        type: DataType.STRING(10),
        allowNull: false,
        unique: true
    })
    declare unitCode: string

    @Column({
        type: DataType.STRING(40),
        allowNull: false
    })
    declare displayName: string

    @Column({
        type: DataType.ENUM("weight", "volume", "count"),
        allowNull: false
    })
    declare unitType: string

    @Column({
        type: DataType.DECIMAL(12, 6),
        allowNull: false
    })
    declare baseFactor: number

    @HasMany(() => Ingredient, "costUnitId")
    declare costIngredients: Ingredient[]

    @HasMany(() => ProductIngredient, "quantityUnitId")
    declare quantityIngredients: ProductIngredient[]
}

export default Unit;
