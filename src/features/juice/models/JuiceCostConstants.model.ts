import { Table, Column, DataType, Model } from "sequelize-typescript"

@Table({
    tableName: "juiceCostConstants",
    version: "revision",
    indexes: [{ unique: true, fields: ["singletonKey"] }],
})
class JuiceCostConstants extends Model {
    @Column({ type: DataType.ENUM("global"), allowNull: false, defaultValue: "global" })
    declare singletonKey: string

    @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
    declare revision: number

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: false })
    declare directLaborPerPound: number

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: false })
    declare indirectLaborPerPound: number

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: false })
    declare financialPerPound: number

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: false })
    declare fixedPerPound: number

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: false })
    declare electricityPerPound: number

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: false })
    declare cleaningPerPound: number

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: false })
    declare laboratoryPerPound: number

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: false })
    declare hppPerPound: number

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: false })
    declare palletizingPerContainer: number

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: false })
    declare localCustomsPerContainer: number

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: false })
    declare miamiCustomsPerContainer: number

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: false })
    declare freightPerContainer: number

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: false })
    declare inOutPerContainer: number

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: false })
    declare accesorialPerContainer: number

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: false })
    declare storagePerContainer: number

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: false })
    declare logisticMovementPerContainer: number

    @Column({ type: DataType.DECIMAL(14, 6), allowNull: false })
    declare unexpectedRate: number

    @Column({ type: DataType.DECIMAL(14, 6), allowNull: false })
    declare tariffRate: number

    @Column({ type: DataType.DECIMAL(14, 6), allowNull: false })
    declare portFeeRate: number

    @Column({ type: DataType.DECIMAL(14, 6), allowNull: false })
    declare salesmanCommissionRate: number

    @Column({ type: DataType.DECIMAL(14, 6), allowNull: false })
    declare distributorCommissionRate: number

    @Column({ type: DataType.INTEGER, allowNull: false })
    declare palletsPerContainer: number

}

export default JuiceCostConstants
