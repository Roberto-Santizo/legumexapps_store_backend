import { Table, Column, DataType, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import RawMaterial from "../../rawMaterial/models/RawMaterial.model";
import Ingredient from "../../ingredient/models/Ingredient.model";

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

    @HasMany(() => RawMaterial, "costUnitId")
    declare costRawMaterials: RawMaterial[]

    @HasMany(() => Ingredient, "costUnitId")
    declare costIngredients: Ingredient[]
}

export default Unit;
