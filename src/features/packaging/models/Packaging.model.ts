import { Table, Column, DataType, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import ProductVariant from "../../product/models/ProductVariant.model";
import ProductVariantPalletMaterial from "../../product/models/ProductVariantPalletMaterial.model";
import ProductVariantUnitMaterial from "../../product/models/ProductVariantUnitMaterial.model";

@Table({
    tableName: "packagings"
})
class Packaging extends BaseCatalogModel {
    // Código manual del material (ej. SKU/referencia interna) -- lo escribe el admin a mano,
    // nunca se autogenera. Único a nivel de columna para que no puedan existir dos materiales
    // con el mismo código -- ver packaging.service.ts::assertCodeIsUnique para el chequeo
    // explícito que da un error de negocio claro antes de llegar a este constraint. Mismo
    // patrón que Ingredient.code (ver Ingredient.model.ts).
    @Column({
        type: DataType.STRING(60),
        allowNull: false,
        unique: true,
        validate: {
            notEmpty: true
        }
    })
    declare code: string

    @Column({
        type: DataType.STRING(80),
        allowNull: false
    })
    declare displayName: string

    @Column({
        type: DataType.ENUM("unit", "intermediate", "pallet"),
        allowNull: false,
        defaultValue: "unit"
    })
    declare packagingRole: string

    @Column({
        type: DataType.STRING(80),
        allowNull: true
    })
    declare packagingMaterial: string
    @Column({
        type: DataType.DECIMAL(10, 4),
        allowNull: true
    })
    declare unitCost: number

    @HasMany(() => ProductVariantUnitMaterial, "packagingId")
    declare unitMaterialUsages: ProductVariantUnitMaterial[]

    @HasMany(() => ProductVariant, "intermediatePackagingId")
    declare intermediatePackagingUsages: ProductVariant[]

    @HasMany(() => ProductVariantPalletMaterial, "packagingId")
    declare palletMaterialUsages: ProductVariantPalletMaterial[]
}

export default Packaging;
