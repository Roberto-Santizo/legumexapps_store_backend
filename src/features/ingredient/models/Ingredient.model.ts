import { Table, Column, DataType, ForeignKey, BelongsTo, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Unit from "../../unit/models/Unit.model";
import ProductIngredient from "../../product/models/ProductIngredient.model";
import IngredientTranslation from "./IngredientTranslation.model";

@Table({
    tableName: "ingredients"
})
class Ingredient extends BaseCatalogModel {
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

    @Column({
        type: DataType.ENUM("fruit", "vegetable", "pulp", "other"),
        allowNull: false
    })
    declare ingredientType: string

    // true = esta fila del catálogo ES la variante orgánica (con su propio costo, ej. "Piña
    // Orgánica" vs "Piña"). No es "esta materia prima admite pedirse orgánica" -- convencional
    // y orgánico son filas separadas en este catálogo, este flag distingue cuál es cuál.
    // La columna física sigue llamándose "isOrganicAvailable" (no hace falta migrar nada);
    // solo se renombra el nombre en código para que el significado quede claro.
    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        field: "isOrganicAvailable"
    })
    declare isOrganic: boolean

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: true
    })
    declare isMixable: boolean

    @Column({
        type: DataType.DECIMAL(10, 4),
        allowNull: true
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

    // Traducciones a idiomas distintos al español -- ver IngredientTranslation.model.ts.
    @HasMany(() => IngredientTranslation, "ingredientId")
    declare translations: IngredientTranslation[]
}

export default Ingredient;
