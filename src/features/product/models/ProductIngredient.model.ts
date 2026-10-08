import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Product from "./Product.model";
import Ingredient from "../../ingredient/models/Ingredient.model";

// Ingrediente agregado a un producto (sal, azúcar...) -- NO participa del 100% de la receta base
// (ProductRawMaterial), es una línea de costo aparte (quoteService.buildIngredientLines). Se
// guarda tal cual lo escribe el admin -- "40 g en una presentación de 2000 g" -- sin redondear a
// un %: el motor deriva el % (grams / referenceNetWeightGrams × 100) con decimal.js al cotizar y lo
// aplica al peso neto de la presentación cotizada, así escala por presentación igual que la receta.
@Table({
    tableName: "productIngredients",
    indexes: [
        {
            unique: true,
            fields: ["productId", "ingredientId"]
        }
    ]
})
class ProductIngredient extends BaseCatalogModel {
    @ForeignKey(() => Product)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare productId: number

    @ForeignKey(() => Ingredient)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare ingredientId: number

    @Column({
        type: DataType.DECIMAL(10, 3),
        allowNull: false
    })
    declare grams: number

    // Peso neto (g) de la presentación en la que se midieron los `grams` de arriba -- mismo tipo que
    // Presentation.netWeightGrams.
    @Column({
        type: DataType.DECIMAL(10, 2),
        allowNull: false
    })
    declare referenceNetWeightGrams: number

    @Column({
        type: DataType.INTEGER,
        allowNull: false,
        defaultValue: 0
    })
    declare displayOrder: number

    @BelongsTo(() => Product, "productId")
    declare parentProduct: Product

    @BelongsTo(() => Ingredient, "ingredientId")
    declare usedIngredient: Ingredient
}

export default ProductIngredient;
