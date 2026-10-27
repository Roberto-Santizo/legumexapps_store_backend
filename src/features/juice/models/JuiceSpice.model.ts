import Ingredient from "../../ingredient/models/Ingredient.model"
import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript"
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel"
import Juice from "./Juice.model"
import JuiceSpiceMaterial from "./JuiceSpiceMaterial.model"

@Table({
    tableName: "juiceSpices",
    indexes: [
        {
            name: "juice_spices_ingredient_unique",
            unique: true,
            fields: ["juiceId", "ingredientId"]
        },
        {
            unique: true,
            fields: ["juiceId", "spiceMaterialId"]
        }
    ]
})
class JuiceSpice extends BaseCatalogModel {
    @ForeignKey(() => Ingredient)
    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare ingredientId: number | null

    @BelongsTo(() => Ingredient, {
        foreignKey: "ingredientId",
        onDelete: "RESTRICT"
    })
    declare ingredient: Ingredient

    @ForeignKey(() => Juice)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare juiceId: number

    @ForeignKey(() => JuiceSpiceMaterial)
    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare spiceMaterialId: number | null

    @Column({
        type: DataType.DECIMAL(14, 6),
        allowNull: false
    })
    declare gramsPerLiter: number

    @BelongsTo(() => Juice, "juiceId")
    declare juice: Juice

    @BelongsTo(() => JuiceSpiceMaterial, {
        foreignKey: "spiceMaterialId",
        onDelete: "NO ACTION"
    })
    declare spiceMaterial: JuiceSpiceMaterial

}

export default JuiceSpice
