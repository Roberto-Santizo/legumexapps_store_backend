import { Table, Column, DataType, ForeignKey, BelongsTo, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Product from "./Product.model";
import Presentation from "../../presentation/models/Presentation.model";
import Packaging from "../../packaging/models/Packaging.model";
import ProductVariantPalletMaterial from "./ProductVariantPalletMaterial.model";
import ProductVariantUnitMaterial from "./ProductVariantUnitMaterial.model";

@Table({
    tableName: "productVariants"
})
class ProductVariant extends BaseCatalogModel {
    @ForeignKey(() => Product)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare productId: number

    @ForeignKey(() => Presentation)
    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare presentationId: number

    @ForeignKey(() => Packaging)
    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare intermediatePackagingId: number

    @Column({
        type: DataType.STRING(60),
        allowNull: true,
        unique: true
    })
    declare skuCode: string

    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare unitsPerPallet: number

    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare unitsPerBox: number

    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare unitsPerIntermediatePackage: number

    @BelongsTo(() => Product, "productId")
    declare parentProduct: Product

    @BelongsTo(() => Presentation, "presentationId")
    declare sizePresentation: Presentation

    @BelongsTo(() => Packaging, "intermediatePackagingId")
    declare usedIntermediatePackaging: Packaging

    @HasMany(() => ProductVariantPalletMaterial, "productVariantId")
    declare palletMaterials: ProductVariantPalletMaterial[]

    // Materiales de empaque individual (bolsa + etiqueta + tapa, receta-style) -- reemplaza el
    // viejo FK único packagingId (ver git history). Modelado exactamente igual que
    // palletMaterials arriba (join table a nivel de variante, N filas).
    @HasMany(() => ProductVariantUnitMaterial, "productVariantId")
    declare unitMaterials: ProductVariantUnitMaterial[]
}

export default ProductVariant;
