import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import ProductVariant from "./ProductVariant.model";
import Packaging from "../../packaging/models/Packaging.model";

// Empaque intermedio: join N-filas con default + opcional (optionGroup/isDefault), igual que los
// niveles unit/pallet, pero sin cantidad propia: el motor usa
// ProductVariant.unitsPerIntermediatePackage (compartido entre cualquier alternativa elegida).
@Table({
    tableName: "productVariantIntermediateMaterials",
    indexes: [
        {
            name: "pvim_variant_packaging_unique",
            unique: true,
            fields: ["productVariantId", "packagingId"]
        }
    ]
})
class ProductVariantIntermediateMaterial extends BaseCatalogModel {
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
    declare usedIntermediateMaterial: Packaging
}

export default ProductVariantIntermediateMaterial;
