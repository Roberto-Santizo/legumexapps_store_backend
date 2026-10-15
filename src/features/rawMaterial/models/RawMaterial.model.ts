import { Table, Column, DataType, ForeignKey, BelongsTo, HasMany, HasOne } from "sequelize-typescript";
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel";
import Unit from "../../unit/models/Unit.model";
import ProductRawMaterial from "../../product/models/ProductRawMaterial.model";
import RawMaterialTranslation from "./RawMaterialTranslation.model";
import RawMaterialTransformation from "../../rawMaterialTransformation/models/RawMaterialTransformation.model";

@Table({
    tableName: "rawMaterials"
})
class RawMaterial extends BaseCatalogModel {

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
        type: DataType.STRING(120),
        allowNull: false
    })
    declare displayName: string

    @Column({
        type: DataType.STRING(120),
        allowNull: false,
        unique: true
    })
    declare urlSlug: string

    @Column({
        type: DataType.ENUM("fruit", "vegetable", "pulp", "other"),
        allowNull: false
    })
    declare ingredientType: string

    // Costo por libra: la unidad la fija el servidor en cada create/update. costUnit/costUnitId se
    // conservan porque el motor los usa para convertir % -> gramos -> costo.
    @Column({
        type: DataType.DECIMAL(10, 4),
        allowNull: true
    })
    declare costPerUnit: number

    @ForeignKey(() => Unit)
    @Column({
        type: DataType.INTEGER,
        allowNull: true
    })
    declare costUnitId: number

    @BelongsTo(() => Unit, "costUnitId")
    declare costUnit: Unit

    @HasMany(() => ProductRawMaterial, "rawMaterialId")
    declare productRawMaterials: ProductRawMaterial[]

    @HasMany(() => RawMaterialTranslation, "rawMaterialId")
    declare translations: RawMaterialTranslation[]

    // Presente solo si el costo lo calcula el módulo de Transformación de Materia Prima.
    @HasOne(() => RawMaterialTransformation, { foreignKey: "processedRawMaterialId", onDelete: "RESTRICT" })
    declare transformation?: RawMaterialTransformation
}

export default RawMaterial;
