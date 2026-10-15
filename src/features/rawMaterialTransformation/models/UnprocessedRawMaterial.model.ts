import { Table, Column, DataType, HasMany, Model } from "sequelize-typescript"
import { col, fn } from "sequelize"
import RawMaterialTransformation from "./RawMaterialTransformation.model"
import { TRANSFORMATION_CURRENCIES } from "../constants/rawMaterialTransformation.constant"

// Materia prima tal como se compra, antes de procesarla. NO es parte del catálogo que usa el
// cotizador (ese es rawMaterials): solo es el origen de una o varias transformaciones. Su costo es
// compartido por todas ellas, así que cambiarlo recalcula cada transformación asociada.
@Table({
    tableName: "unprocessedRawMaterials",
    indexes: [{ name: "unprocessedRawMaterials_code_unique", unique: true, fields: [fn("lower", col("code"))] }],
})
class UnprocessedRawMaterial extends Model {
    @Column({ type: DataType.STRING(60), allowNull: false, validate: { notEmpty: true } })
    declare code: string

    @Column({ type: DataType.STRING(120), allowNull: false })
    declare displayName: string

    // Costo por libra de entrada, en costCurrency.
    @Column({ type: DataType.DECIMAL(24, 12), allowNull: false })
    declare costPerPound: number

    @Column({ type: DataType.ENUM(...TRANSFORMATION_CURRENCIES), allowNull: false })
    declare costCurrency: string

    @HasMany(() => RawMaterialTransformation, { foreignKey: "unprocessedRawMaterialId", onDelete: "RESTRICT" })
    declare transformations: RawMaterialTransformation[]
}

export default UnprocessedRawMaterial
