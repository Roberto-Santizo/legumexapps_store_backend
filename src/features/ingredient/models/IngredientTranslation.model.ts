import { Table, Column, DataType, ForeignKey, BelongsTo, Model } from "sequelize-typescript";
import Ingredient from "./Ingredient.model";

// Mismo patrón que CategoryTranslation -- ver shared/utils/translation.util.ts.
@Table({
    tableName: "ingredientTranslations",
    indexes: [
        {
            unique: true,
            fields: ["ingredientId", "language"]
        }
    ]
})
class IngredientTranslation extends Model {
    @ForeignKey(() => Ingredient)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare ingredientId: number

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

    @BelongsTo(() => Ingredient, "ingredientId")
    declare parentIngredient: Ingredient
}

export default IngredientTranslation;
