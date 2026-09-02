import { Table, Column, DataType, ForeignKey, BelongsTo, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import SubCategory from "../../category/models/SubCategory.model";
import ProductType from "../../product-type/models/ProductType.model";
import ProductVariant from "./ProductVariant.model";
import ProductIngredient from "./ProductIngredient.model";
import ProductTranslation from "./ProductTranslation.model";

@Table({
    tableName: "products"
})
class Product extends BaseCatalogModel {
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

    // Ajuste manual de costo por unidad (ej. Q0.03, Q0.30) para costos que todavía no están bien
    // definidos en el catálogo (materia prima/empaque/palet/transporte) y que el negocio quiere
    // poder subir/bajar/quitar sin tener que editar ningún catálogo. Nullable a propósito: NULL =
    // sin ajuste (se puede "eliminar" limpiando el campo). Se multiplica por totalUnits igual que
    // el resto de líneas de costo -- ver quoteService.calculateQuote.
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
