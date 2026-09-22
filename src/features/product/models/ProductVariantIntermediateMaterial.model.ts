import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import ProductVariant from "./ProductVariant.model";
import Packaging from "../../packaging/models/Packaging.model";

// Empaque intermedio (2026-09-21) -- reemplaza ProductVariant.intermediatePackagingId (FK único,
// ver CLAUDE.md #4 "SKU = Product + Presentation" y la entrada de cambio de esta fecha). Mismo
// join N-filas que ProductVariantUnitMaterial/ProductVariantPalletMaterial, con default + opcional
// (isSwappable/isDefault, ver el comentario en ProductVariantUnitMaterial.model.ts) -- pero sin
// cantidad propia: el motor sigue leyendo ProductVariant.unitsPerIntermediatePackage (compartido
// entre cualquier alternativa elegida, no varía por material -- decisión de negocio 2026-09-21).
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
        type: DataType.BOOLEAN,
        allowNull: false,
        defaultValue: false
    })
    declare isSwappable: boolean

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
