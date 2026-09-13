import { Table, Column, DataType, ForeignKey, BelongsTo, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Product from "./Product.model";
import Presentation from "../../presentation/models/Presentation.model";
import Packaging from "../../packaging/models/Packaging.model";
import ProductVariantPalletMaterial from "./ProductVariantPalletMaterial.model";
import ProductVariantUnitMaterial from "./ProductVariantUnitMaterial.model";

@Table({
    tableName: "productVariants",
    indexes: [
        {
            // Nombrado a propósito -- mismo motivo que products_codigo_unique en Product.model.ts:
            // un `unique: true` inline a nivel de columna genera un nombre de índice autogenerado
            // por Sequelize, que puede no sobrevivir limpio a sucesivos `sync({alter:true})`. skuCode
            // ya era único a nivel de columna antes de este cambio (2026-09-13) -- este índice
            // nombrado reemplaza a ese, no es una restricción nueva.
            name: "productVariants_skuCode_unique",
            unique: true,
            fields: ["skuCode"]
        }
    ]
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

    // Código SKU -- pasó de opcional a REQUERIDO (2026-09-13, ver productVariant.schema.ts): es
    // la clave que une el catálogo con los 3 Excel de origen (empaques/presentaciones/SKUs) y la
    // que usa el autofill (productVariantService.findVariantConfigBySkuCode). El chequeo de
    // negocio case-insensitive vive en productVariant.service.ts::assertSkuCodeIsUnique -- mismo
    // patrón que Product.codigo/Packaging.code/Ingredient.code. La columna en sí sigue
    // `allowNull: true` (no `false`): igual que boxesPerPallet/bagsPerBox, una variante vieja sin
    // skuCode sigue pudiendo abrirse para editar, solo no se puede volver a GUARDAR sin
    // completarlo (ver productVariantSection.component.tsx::toFormValues, Partial<VariantFormInput>).
    @Column({
        type: DataType.STRING(60),
        allowNull: true
    })
    declare skuCode: string

    // "Palet" pasó de un input manual único (unitsPerPallet = bolsas/palet, a mano, sin ayuda) a
    // dos factores explícitos que el motor multiplica (2026-09-12, ver quoteService.calculateQuote):
    // boxesPerPallet × bagsPerBox = bagsPerPallet (derivado, nunca se guarda). unitsPerPallet se
    // retiró del modelo (columna física huérfana, sigue en Postgres -- este repo usa
    // sequelize.sync sin migraciones, ver memoria del proyecto).
    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare boxesPerPallet: number

    // Renombrado de unitsPerBox -- mismo campo físico (columna "unitsPerBox" preservada vía
    // `field`, mismo truco que Ingredient.isOrganic sobre la columna "isOrganicAvailable", ver
    // memoria del proyecto). Antes era puramente informativo/opcional (ayudaba a llenar a mano la
    // fila de la caja en ProductVariantPalletMaterial); ahora es uno de los dos factores
    // OBLIGATORIOS de bagsPerPallet, así que su significado ("bolsas por caja") no cambió, solo
    // dejó de ser opcional y pasó a alimentar el cálculo real.
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
