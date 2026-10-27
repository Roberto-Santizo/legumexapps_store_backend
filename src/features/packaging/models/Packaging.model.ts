import { Table, Column, DataType, HasMany } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import type { PackagingMaterialType } from "../constants/packagingMaterialType.constant";
import ProductVariantIntermediateMaterial from "../../product/models/ProductVariantIntermediateMaterial.model";
import ProductVariantPalletMaterial from "../../product/models/ProductVariantPalletMaterial.model";
import ProductVariantUnitMaterial from "../../product/models/ProductVariantUnitMaterial.model";

@Table({
    tableName: "packagings"
})
class Packaging extends BaseCatalogModel {
    // Specific codes come from the administrator; generic codes are generated transactionally.
    // The unique column constraint protects both paths.
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
        type: DataType.STRING(8),
        allowNull: false,
        defaultValue: "specific",
        validate: {
            isIn: [["specific", "generic"]]
        }
    })
    declare classification: "specific" | "generic"

    @Column({
        type: DataType.STRING(80),
        allowNull: false
    })
    declare displayName: string

    @Column({
        type: DataType.STRING(80),
        allowNull: true
    })
    declare displayNameEn: string | null

    @Column({
        type: DataType.ENUM("unit", "intermediate", "pallet"),
        allowNull: false,
        defaultValue: "unit"
    })
    declare packagingRole: string

    @Column({
        type: DataType.DECIMAL(18, 12),
        allowNull: true
    })
    declare unitCost: number

    @Column({
        type: DataType.ENUM("per_box", "per_pallet"),
        allowNull: true
    })
    declare defaultQuantityBasis: "per_box" | "per_pallet" | null

    @Column({
        type: DataType.DECIMAL(10, 2),
        allowNull: true
    })
    declare defaultQuantityValue: number | null

    // INDIVIDUAL / INTERMEDIO for those levels; CAJA, TARIMA, ESQUINERO, STRETCH or OTRO for pallet materials
    // (constants/packagingMaterialType.constant.ts). It decides the catalog consumption and the pallet kit rules.
    @Column({
        type: DataType.STRING(12),
        allowNull: false
    })
    declare materialType: PackagingMaterialType

    @HasMany(() => ProductVariantUnitMaterial, "packagingId")
    declare unitMaterialUsages: ProductVariantUnitMaterial[]

    @HasMany(() => ProductVariantIntermediateMaterial, "packagingId")
    declare intermediateMaterialUsages: ProductVariantIntermediateMaterial[]

    @HasMany(() => ProductVariantPalletMaterial, "packagingId")
    declare palletMaterialUsages: ProductVariantPalletMaterial[]
}

export default Packaging;
