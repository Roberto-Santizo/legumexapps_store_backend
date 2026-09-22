import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Product from "./Product.model";
import Ingredient from "../../ingredient/models/Ingredient.model";

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

    // Solo aplica cuando el producto padre es de receta fija (!Product.isCustomizable): el
    // admin fija este % al crear el producto y el cliente nunca puede alterarlo (ver
    // quoteService.buildFixedPercentageRawMaterials). Reemplaza el viejo quantityValue (cantidad
    // absoluta, independiente de la presentación) -- ahora la receta fija usa la MISMA base
    // matemática (% del peso neto) que el mix personalizable, solo que quien fija el % es el
    // admin, no el cliente.
    @Column({
        type: DataType.DECIMAL(5, 2),
        allowNull: true
    })
    declare percentage: number

    @Column({
        type: DataType.DECIMAL(5, 2),
        allowNull: true
    })
    declare minPercentage: number

    @Column({
        type: DataType.DECIMAL(5, 2),
        allowNull: true
    })
    declare maxPercentage: number

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
