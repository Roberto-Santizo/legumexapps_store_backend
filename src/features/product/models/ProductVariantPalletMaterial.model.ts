import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import ProductVariant from "./ProductVariant.model";
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

    @BelongsTo(() => ProductVariant, "productVariantId")
    declare parentProductVariant: ProductVariant

    @BelongsTo(() => Packaging, "packagingId")
    declare usedPalletMaterial: Packaging
}

export default ProductVariantPalletMaterial;
