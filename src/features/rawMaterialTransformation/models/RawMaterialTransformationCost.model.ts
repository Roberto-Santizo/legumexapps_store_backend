import { Table, Column, DataType, ForeignKey, BelongsTo, Model } from "sequelize-typescript"
import RawMaterialTransformation from "./RawMaterialTransformation.model"
import {
    TRANSFORMATION_COST_BASES,
    TRANSFORMATION_COST_CATEGORIES,
} from "../constants/rawMaterialTransformation.constant"

// Un concepto de costo adicional (lavado, bolsa, electricidad...). Los nombres son libres: agregar
// un gasto nuevo no requiere cambiar código.
@Table({
    tableName: "rawMaterialTransformationCosts",
    indexes: [
        {
            name: "rawMaterialTransformationCosts_transformation_category_idx",
            fields: ["transformationId", "category"]
        }
    ]
})
class RawMaterialTransformationCost extends Model {
    @ForeignKey(() => RawMaterialTransformation)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare transformationId: number

    @BelongsTo(() => RawMaterialTransformation, {
        foreignKey: "transformationId",
        onDelete: "CASCADE"
    })
    declare transformation: RawMaterialTransformation

    @Column({
        type: DataType.ENUM(...TRANSFORMATION_COST_CATEGORIES),
        allowNull: false
    })
    declare category: string

    @Column({
        type: DataType.STRING(120),
        allowNull: false
    })
    declare conceptName: string

    // En USD.
    @Column({
        type: DataType.DECIMAL(24, 12),
        allowNull: false
    })
    declare amount: number

    @Column({
        type: DataType.ENUM(...TRANSFORMATION_COST_BASES),
        allowNull: false
    })
    declare costBasis: string

    // Libras procesadas que cubre una unidad o un lote; solo para per_unit / per_batch.
    @Column({
        type: DataType.DECIMAL(14, 4),
        allowNull: true
    })
    declare poundsPerUnit: number | null

    @Column({
        type: DataType.DECIMAL(24, 12),
        allowNull: false
    })
    declare costUsdPerProcessedPound: number

    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare sortOrder: number
}

export default RawMaterialTransformationCost
