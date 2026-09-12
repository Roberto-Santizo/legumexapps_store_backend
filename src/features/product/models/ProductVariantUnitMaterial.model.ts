import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import ProductVariant from "./ProductVariant.model";
import Packaging from "../../packaging/models/Packaging.model";

// Materiales de empaque individual de una variante (bolsa + etiqueta + tapa...), receta-style --
// mismo diseño que ProductVariantPalletMaterial (join table a nivel de variante, N filas), solo
// que acá el Packaging referenciado debe tener packagingRole "unit" en vez de "pallet" (validado
// en productVariantUnitMaterial.service.ts::assertPackagingHasRole, no a nivel de columna).
// Reemplaza el viejo FK único ProductVariant.packagingId.
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

    // Cuántas unidades de este material lleva CADA unidad de producto (ej. 1 bolsa + 1 etiqueta +
    // 2 tapas por unidad). Tabla nueva sin filas existentes -- a diferencia de
    // ProductVariantPalletMaterial.quantityValue (allowNull:true por compatibilidad con datos
    // viejos), acá no hay ese problema: allowNull:false con defaultValue:1 desde el día uno.
    @Column({
        type: DataType.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 1
    })
    declare quantityPerUnit: number

    @BelongsTo(() => ProductVariant, "productVariantId")
    declare parentProductVariant: ProductVariant

    @BelongsTo(() => Packaging, "packagingId")
    declare usedUnitMaterial: Packaging
}

export default ProductVariantUnitMaterial;
