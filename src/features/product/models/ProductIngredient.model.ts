import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Product from "./Product.model";
import Ingredient from "../../ingredient/models/Ingredient.model";
import Unit from "../../unit/models/Unit.model";

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
        type: DataType.DECIMAL(10, 2),
        allowNull: true
    })
    declare quantityValue: number

    @ForeignKey(() => Unit)
    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare quantityUnitId: number

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

    @BelongsTo(() => Unit, "quantityUnitId")
    declare quantityUnit: Unit
}

export default ProductIngredient;
