import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Ingredient from "../../ingredient/models/Ingredient.model";

// Ingrediente agregado (sal, azúcar...) que un representante puede sumar a un producto a la medida.
// Lista global (no por subcategoría). maxGramsPerKg: tope opcional expresado en gramos por kg de
// peso neto, así el mismo tope vale para cualquier presentación (500 g o 2 kg); null = sin tope.
@Table({
    tableName: "customQuoteIngredientOptions",
    indexes: [
        {
            name: "cqio_ingredient_unique",
            unique: true,
            fields: ["ingredientId"]
        }
    ]
})
class CustomQuoteIngredientOption extends BaseCatalogModel {
    @ForeignKey(() => Ingredient)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare ingredientId: number

    @Column({
        type: DataType.DECIMAL(10, 3),
        allowNull: true
    })
    declare maxGramsPerKg: number | null

    @BelongsTo(() => Ingredient, "ingredientId")
    declare usedIngredient: Ingredient
}

export default CustomQuoteIngredientOption;
