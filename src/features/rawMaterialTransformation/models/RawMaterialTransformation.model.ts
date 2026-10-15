import { Table, Column, DataType, ForeignKey, BelongsTo, HasMany, Model } from "sequelize-typescript"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import UnprocessedRawMaterial from "./UnprocessedRawMaterial.model"
import RawMaterialTransformationCost from "./RawMaterialTransformationCost.model"
import { TRANSFORMATION_CURRENCIES } from "../constants/rawMaterialTransformation.constant"

// Origen (sin procesar) -> registro procesado del catálogo rawMaterials, con los datos y el
// desglose que produjeron su costo. Cada materia prima del catálogo tiene como máximo una
// transformación (processedRawMaterialId único); un mismo origen puede producir varias.
@Table({
    tableName: "rawMaterialTransformations",
    indexes: [{ name: "rawMaterialTransformations_unprocessed_idx", fields: ["unprocessedRawMaterialId"] }],
})
class RawMaterialTransformation extends Model {
    @ForeignKey(() => UnprocessedRawMaterial)
    @Column({ type: DataType.INTEGER, allowNull: false })
    declare unprocessedRawMaterialId: number

    @BelongsTo(() => UnprocessedRawMaterial, { foreignKey: "unprocessedRawMaterialId", onDelete: "RESTRICT" })
    declare unprocessedRawMaterial: UnprocessedRawMaterial

    @ForeignKey(() => RawMaterial)
    @Column({ type: DataType.INTEGER, allowNull: false, unique: true })
    declare processedRawMaterialId: number

    @BelongsTo(() => RawMaterial, { foreignKey: "processedRawMaterialId", onDelete: "RESTRICT" })
    declare processedRawMaterial: RawMaterial

    // Flete por libra de entrada, en freightCurrency.
    @Column({ type: DataType.DECIMAL(24, 12), allowNull: false })
    declare freightPerPound: number

    @Column({ type: DataType.ENUM(...TRANSFORMATION_CURRENCIES), allowNull: false })
    declare freightCurrency: string

    // Porcentaje (0, 100].
    @Column({ type: DataType.DECIMAL(7, 4), allowNull: false })
    declare yieldPercentage: number

    // Quetzales por 1 USD efectivamente usados en el cálculo, para poder reproducirlo.
    @Column({ type: DataType.DECIMAL(14, 6), allowNull: false })
    declare exchangeRate: number

    // Resultado del cálculo en USD por libra (entrada para los dos primeros, procesada el resto).
    @Column({ type: DataType.DECIMAL(24, 12), allowNull: false })
    declare inputCostUsdPerPound: number

    @Column({ type: DataType.DECIMAL(24, 12), allowNull: false })
    declare freightUsdPerPound: number

    @Column({ type: DataType.DECIMAL(24, 12), allowNull: false })
    declare rawMaterialCostUsd: number

    @Column({ type: DataType.DECIMAL(24, 12), allowNull: false })
    declare directLaborCostUsd: number

    @Column({ type: DataType.DECIMAL(24, 12), allowNull: false })
    declare packagingCostUsd: number

    @Column({ type: DataType.DECIMAL(24, 12), allowNull: false })
    declare otherCostUsd: number

    @Column({ type: DataType.DECIMAL(24, 12), allowNull: false })
    declare processedCostUsd: number

    @HasMany(() => RawMaterialTransformationCost, { foreignKey: "transformationId", onDelete: "CASCADE" })
    declare costs: RawMaterialTransformationCost[]
}

export default RawMaterialTransformation
