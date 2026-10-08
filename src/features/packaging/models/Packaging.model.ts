import { Table, Column, DataType, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import ProductVariantIntermediateMaterial from "../../product/models/ProductVariantIntermediateMaterial.model";
import ProductVariantPalletMaterial from "../../product/models/ProductVariantPalletMaterial.model";
import ProductVariantUnitMaterial from "../../product/models/ProductVariantUnitMaterial.model";

@Table({
    tableName: "packagings"
})
class Packaging extends BaseCatalogModel {
    // Código manual del material (lo escribe el admin, nunca se autogenera). Único a nivel de columna;
    // packaging.service.ts::assertCodeIsUnique da antes un error de negocio claro.
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
        type: DataType.DECIMAL(10, 4),
        allowNull: true
    })
    declare unitCost: number

    @Column({ type: DataType.ENUM("per_box", "per_pallet"), allowNull: true })
    declare defaultQuantityBasis: "per_box" | "per_pallet" | null

    @Column({ type: DataType.DECIMAL(10, 2), allowNull: true })
    declare defaultQuantityValue: number | null

    @HasMany(() => ProductVariantUnitMaterial, "packagingId")
    declare unitMaterialUsages: ProductVariantUnitMaterial[]

    @HasMany(() => ProductVariantIntermediateMaterial, "packagingId")
    declare intermediateMaterialUsages: ProductVariantIntermediateMaterial[]

    @HasMany(() => ProductVariantPalletMaterial, "packagingId")
    declare palletMaterialUsages: ProductVariantPalletMaterial[]
}

export default Packaging;
