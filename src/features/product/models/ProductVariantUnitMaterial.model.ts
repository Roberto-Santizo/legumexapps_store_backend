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

    // Grupos de opciones (2026-09-24, ver CLAUDE.md #4 -- reemplaza el viejo isSwappable): null
    // (default) es una fila de receta incondicional, siempre se costea. Un nombre de grupo (texto
    // libre del admin, ej. "Bolsa", "Etiqueta") marca la fila como alternativa dentro de ESE grupo:
    // el cliente elige una por grupo, y los grupos distintos de un mismo nivel se suman. Dentro de
    // cada grupo exactamente una fila es isDefault (ver productVariantUnitMaterial.service.ts); la
    // comparación de nombres es insensible a mayúsculas/espacios (shared/utils/optionGroup.util.ts).
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
    declare usedUnitMaterial: Packaging
}

export default ProductVariantUnitMaterial;
