import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import ProductVariant from "./ProductVariant.model";
import PackagingGroup from "../../packagingGroup/models/PackagingGroup.model";
import Packaging from "../../packaging/models/Packaging.model";

@Table({
    tableName: "productVariantPalletMaterials",
    indexes: [
        {
            name: "pvpm_variant_packaging_unique",
            unique: true,
            fields: ["productVariantId", "packagingId"]
        }
    ]
})
class ProductVariantPalletMaterial extends BaseCatalogModel {
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
        allowNull: true
    })
    declare quantityValue: number

    // Explicit consumption rule; labels never determine quantities.
    @Column({ type: DataType.ENUM("per_box", "per_pallet"), allowNull: false, defaultValue: "per_pallet" })
    declare quantityBasis: "per_box" | "per_pallet"

    @ForeignKey(() => PackagingGroup)
    @Column({ type: DataType.INTEGER, allowNull: true })
    declare optionGroupId: number | null

    @BelongsTo(() => PackagingGroup, "optionGroupId")
    declare packagingGroup: PackagingGroup | null

    // Grupos de opciones (ej. grupo "Caja" + grupo "Esquinero" en un mismo SKU).
    @Column({
        type: DataType.STRING(60),
        allowNull: true
    })
    declare optionGroup: string | null

    @Column({
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false
    })
    declare isDefault: boolean

    @BelongsTo(() => ProductVariant, "productVariantId")
    declare parentProductVariant: ProductVariant

    @BelongsTo(() => Packaging, "packagingId")
    declare usedPalletMaterial: Packaging
}

export default ProductVariantPalletMaterial;
