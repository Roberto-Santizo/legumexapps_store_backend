import { Table, Column, DataType, ForeignKey, BelongsTo, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Product from "./Product.model";
import Presentation from "../../presentation/models/Presentation.model";
import ProductVariantPalletMaterial from "./ProductVariantPalletMaterial.model";
import ProductVariantUnitMaterial from "./ProductVariantUnitMaterial.model";
import ProductVariantIntermediateMaterial from "./ProductVariantIntermediateMaterial.model";

@Table({
    tableName: "productVariants",
})
class ProductVariant extends BaseCatalogModel {
    @ForeignKey(() => Product)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare productId: number

    // Requerido: cada SKU (variante) debe estar atado a exactamente una Presentación
    // -- ya no hay variantes "sin presentación". Además es inmutable una vez creada (ver
    // productVariant.service.ts::assertPresentationNotChanged): cambiar de presentación exige
    // crear un SKU nuevo, no reasignar este. Junto con Product.codigo, (productId, presentationId)
    // ES la identidad del SKU (ver assertPresentationNotAlreadyUsed) -- ya no hay un
    // skuCode propio de la variante.
    @ForeignKey(() => Presentation)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare presentationId: number

    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare boxesPerPallet: number


    @Column({
        type: DataType.INTEGER,
        allowNull: true,
        field: "unitsPerBox"
    })
    declare bagsPerBox: number

    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare unitsPerIntermediatePackage: number

    @BelongsTo(() => Product, "productId")
    declare parentProduct: Product

    @BelongsTo(() => Presentation, "presentationId")
    declare sizePresentation: Presentation

    @HasMany(() => ProductVariantPalletMaterial, "productVariantId")
    declare palletMaterials: ProductVariantPalletMaterial[]

    @HasMany(() => ProductVariantUnitMaterial, "productVariantId")
    declare unitMaterials: ProductVariantUnitMaterial[]

    // Default + opcional -- reemplaza el FK único intermediatePackagingId (eliminado
    // del modelo; unitsPerIntermediatePackage se queda arriba, compartido entre alternativas).
    @HasMany(() => ProductVariantIntermediateMaterial, "productVariantId")
    declare intermediateMaterials: ProductVariantIntermediateMaterial[]
}

export default ProductVariant;
