import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import ProductVariant from "./ProductVariant.model";
import Packaging from "../../packaging/models/Packaging.model";

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

    // Default + opcional (2026-09-21, ver CLAUDE.md #4): isSwappable=false (default) es el
    // comportamiento de siempre, fila de receta incondicional -- siempre se costea. isSwappable=true
    // marca la fila como parte del menú de alternativas que el cliente puede elegir en el
    // cotizador para este nivel; entre las filas isSwappable=true de una misma variante, exactamente
    // una debe ser isDefault (ver productVariantUnitMaterial.service.ts).
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
    declare usedUnitMaterial: Packaging
}

export default ProductVariantUnitMaterial;
