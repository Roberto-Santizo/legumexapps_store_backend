import { Table, Column, DataType, ForeignKey, BelongsTo, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import SubCategory from "../../category/models/SubCategory.model";
import ProductType from "../../product-type/models/ProductType.model";
import ProductVariant from "./ProductVariant.model";
import ProductIngredient from "./ProductIngredient.model";
import ProductTranslation from "./ProductTranslation.model";

@Table({
    tableName: "products",
    indexes: [
        {
            name: "products_codigo_unique",
            unique: true,
            fields: ["codigo"]
        }
    ]
})
class Product extends BaseCatalogModel {
    // Código manual del producto -- lo escribe el admin a mano, nunca se autogenera (a
    // diferencia de urlSlug). Único a nivel de índice nombrado (products_codigo_unique, ver
    // arriba) para que sync/alter no duplique el índice en cada arranque -- el chequeo de
    // negocio real (case-insensitive) vive en product.service.ts::assertCodigoIsUnique, que da
    // un error traducido claro ANTES de llegar a este constraint (que sería case-sensitive y
    // daría el 409 genérico "errors.unique_constraint", menos útil para el admin). Mismo patrón
    // que Packaging.code / Ingredient.code.
    @Column({
        type: DataType.STRING(60),
        allowNull: false,
        validate: {
            notEmpty: true
        }
    })
    declare codigo: string

    @ForeignKey(() => SubCategory)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare subCategoryId: number

    @ForeignKey(() => ProductType)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare productTypeId: number

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
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false
    })
    declare isOrganic: boolean


    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false
    })
    declare isCustomizable: boolean


    @Column({
        type: DataType.STRING(500),
        allowNull: true
    })
    declare imageUrl: string | null

    @Column({
        type: DataType.DECIMAL(10, 4),
        allowNull: true
    })
    declare additionalCostPerUnit: number | null

    @BelongsTo(() => SubCategory, "subCategoryId")
    declare parentSubCategory: SubCategory

    @BelongsTo(() => ProductType, "productTypeId")
    declare parentProductType: ProductType

    @HasMany(() => ProductVariant, "productId")
    declare productVariants: ProductVariant[]

    @HasMany(() => ProductIngredient, "productId")
    declare productIngredients: ProductIngredient[]

    @HasMany(() => ProductTranslation, "productId")
    declare translations: ProductTranslation[]
}

export default Product;
