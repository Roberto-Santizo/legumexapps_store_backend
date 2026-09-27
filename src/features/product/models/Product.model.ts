import { Table, Column, DataType, ForeignKey, BelongsTo, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import SubCategory from "../../category/models/SubCategory.model";
import Client from "../../client/models/Client.model";
import ProductVariant from "./ProductVariant.model";
import ProductRawMaterial from "./ProductRawMaterial.model";
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

    // Requerido (2026-09-16): cada Producto pertenece a exactamente un Cliente (el catálogo real
    // de clientes, ver features/client/ -- no confundir con salesperson/, la cuenta que cotiza).
    @ForeignKey(() => Client)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare clientId: number

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

    @BelongsTo(() => Client, "clientId")
    declare client: Client

    @HasMany(() => ProductVariant, "productId")
    declare productVariants: ProductVariant[]

    @HasMany(() => ProductRawMaterial, "productId")
    declare productRawMaterials: ProductRawMaterial[]

    @HasMany(() => ProductTranslation, "productId")
    declare translations: ProductTranslation[]
}

export default Product;
