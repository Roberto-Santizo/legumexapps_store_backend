import { Table, Column, DataType, ForeignKey, BelongsTo, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Unit from "../../unit/models/Unit.model";
import ProductIngredient from "../../product/models/ProductIngredient.model";
import IngredientTranslation from "./IngredientTranslation.model";

@Table({
    tableName: "ingredients"
})
class Ingredient extends BaseCatalogModel {
    // Código manual del ingrediente (ej. SKU/referencia interna) -- lo escribe el admin a mano,
    // nunca se autogenera (a diferencia de urlSlug). Único a nivel de columna para que no puedan
    // existir dos ingredientes con el mismo código -- ver ingredient.service.ts::assertCodeIsUnique
    // para el chequeo explícito que da un error de negocio claro antes de llegar a este constraint.
    @Column({
        type: DataType.STRING(60),
        allowNull: false,
        unique: true,
        // notEmpty: además del allowNull:false (que solo bloquea NULL, no ""), esto rechaza a
        // nivel de Sequelize una cadena vacía o de puros espacios -- defensa en profundidad para
        // cualquier escritura que no pase por ingredient.schema.ts (hoy no existe ninguna, ver
        // ingredient.service.ts: create/bulk import son los únicos dos caminos y ambos validan
        // con zod primero), no solo para la API HTTP.
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

    @Column({
        type: DataType.ENUM("fruit", "vegetable", "pulp", "other"),
        allowNull: false
    })
    declare ingredientType: string

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

    @HasMany(() => IngredientTranslation, "ingredientId")
    declare translations: IngredientTranslation[]
}

export default Ingredient;
