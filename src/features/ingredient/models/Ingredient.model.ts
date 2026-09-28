import { Table, Column, DataType, ForeignKey, BelongsTo, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Unit from "../../unit/models/Unit.model";
import ProductIngredient from "../../product/models/ProductIngredient.model";
import IngredientTranslation from "./IngredientTranslation.model";

// Ingredientes agregados (sal, azúcar, pimienta...) -- concepto DISTINTO de RawMaterial (la base
// de fruta/vegetal que suma 100% de la receta). Se agregan a un producto como gramos que escalan
// con la presentación (ver ProductIngredient) y generan su propia línea de costo
// (quoteService.buildIngredientLines), fuera del 100% de la receta base.
@Table({
    tableName: "ingredients"
})
class Ingredient extends BaseCatalogModel {

    @Column({
        type: DataType.STRING(60),
        allowNull: false,
        unique: true,

        validate: {
            notEmpty: true
        }
    })
    declare code: string

    @Column({
        type: DataType.STRING(120),
        allowNull: false
    })
    declare displayName: string

    @Column({
        type: DataType.STRING(120),
        allowNull: false,
        unique: true
    })
    declare urlSlug: string

    // Costo por libra -- igual que RawMaterial, la unidad de costeo la fuerza el servidor a la
    // Libra en cada create/update/import (unitService.findOrCreatePoundUnit). costUnitId se
    // conserva en el modelo para poder abrir la elección de unidad más adelante sin tocar el
    // motor (que ya divide por costUnit.baseFactor).
    @Column({
        type: DataType.DECIMAL(10, 4),
        allowNull: false
    })
    declare costPerUnit: number

    @ForeignKey(() => Unit)
    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare costUnitId: number

    @BelongsTo(() => Unit, "costUnitId")
    declare costUnit: Unit

    @HasMany(() => ProductIngredient, "ingredientId")
    declare productIngredients: ProductIngredient[]

    @HasMany(() => IngredientTranslation, "ingredientId")
    declare translations: IngredientTranslation[]
}

export default Ingredient;
