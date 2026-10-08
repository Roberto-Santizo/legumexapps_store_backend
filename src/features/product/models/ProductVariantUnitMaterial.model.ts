import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import ProductVariant from "./ProductVariant.model";
import Packaging from "../../packaging/models/Packaging.model";
import PackagingGroup from "../../packagingGroup/models/PackagingGroup.model";

@Table({
    tableName: "productVariantUnitMaterials",
    indexes: [
        {
            name: "pvum_variant_packaging_unique",
            unique: true,
            fields: ["productVariantId", "packagingId"]
        }
    ]
})
class ProductVariantUnitMaterial extends BaseCatalogModel {
    @ForeignKey(() => ProductVariant)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare productVariantId: number

    @ForeignKey(() => Packaging)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare packagingId: number


    @Column({
        type: DataType.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 1
    })
    declare quantityPerUnit: number

    // Etiqueta compatible de grupos anteriores, conservada para snapshots y lectores existentes.
    // Nuevas asociaciones se identifican por optionGroupId, no por esta etiqueta mutable.
    @Column({
        type: DataType.STRING(60),
        allowNull: true
    })
    declare optionGroup: string | null

    @ForeignKey(() => PackagingGroup)
    @Column({ type: DataType.INTEGER, allowNull: true })
    declare optionGroupId: number | null

    @BelongsTo(() => PackagingGroup, "optionGroupId")
    declare optionGroupCatalog: PackagingGroup

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false
    })
    declare isDefault: boolean

    @BelongsTo(() => ProductVariant, "productVariantId")
    declare parentProductVariant: ProductVariant

    @BelongsTo(() => Packaging, "packagingId")
    declare usedUnitMaterial: Packaging
}

export default ProductVariantUnitMaterial;
