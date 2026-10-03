import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript"
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel"
import Client from "../../client/models/Client.model"

@Table({
    tableName: "juiceClientConstantOverrides",
    indexes: [{ unique: true, fields: ["clientId"] }],
})
class JuiceClientConstantOverride extends BaseCatalogModel {
    @ForeignKey(() => Client)
    @Column({ type: DataType.INTEGER, allowNull: false })
    declare clientId: number

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: true })
    declare directLaborPerPound: number | null

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: true })
    declare indirectLaborPerPound: number | null

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: true })
    declare financialPerPound: number | null

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: true })
    declare fixedPerPound: number | null

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: true })
    declare electricityPerPound: number | null

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: true })
    declare cleaningPerPound: number | null

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: true })
    declare laboratoryPerPound: number | null

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: true })
    declare hppPerPound: number | null

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: true })
    declare palletizingPerContainer: number | null

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: true })
    declare localCustomsPerContainer: number | null

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: true })
    declare miamiCustomsPerContainer: number | null

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: true })
    declare freightPerContainer: number | null

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: true })
    declare inOutPerContainer: number | null

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: true })
    declare accesorialPerContainer: number | null

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: true })
    declare storagePerContainer: number | null

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: true })
    declare logisticMovementPerContainer: number | null

    @Column({ type: DataType.DECIMAL(14, 6), allowNull: true })
    declare unexpectedRate: number | null

    @Column({ type: DataType.DECIMAL(14, 6), allowNull: true })
    declare tariffRate: number | null

    @Column({ type: DataType.DECIMAL(14, 6), allowNull: true })
    declare portFeeRate: number | null

    @Column({ type: DataType.DECIMAL(14, 6), allowNull: true })
    declare salesmanCommissionRate: number | null

    @Column({ type: DataType.DECIMAL(14, 6), allowNull: true })
    declare distributorCommissionRate: number | null

    @Column({ type: DataType.INTEGER, allowNull: true })
    declare palletsPerContainer: number | null

    @BelongsTo(() => Client, "clientId")
    declare client: Client

}

export default JuiceClientConstantOverride
