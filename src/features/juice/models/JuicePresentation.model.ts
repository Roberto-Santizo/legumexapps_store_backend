import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript"
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel"
import Juice from "./Juice.model"

@Table({
    tableName: "juicePresentations",
    indexes: [{ unique: true, fields: ["juiceId", "displayLabel"] }],
})
class JuicePresentation extends BaseCatalogModel {
    @ForeignKey(() => Juice)
    @Column({ type: DataType.INTEGER, allowNull: false })
    declare juiceId: number

    @Column({ type: DataType.STRING(120), allowNull: false })
    declare displayLabel: string

    @Column({ type: DataType.DECIMAL(14, 3), allowNull: false })
    declare mlPerBottle: number

    @Column({ type: DataType.INTEGER, allowNull: false })
    declare bottlesPerCase: number

    @Column({ type: DataType.INTEGER, allowNull: false })
    declare casesPerPallet: number

    @Column({ type: DataType.DECIMAL(24, 12), allowNull: false })
    declare boxUnitCost: number

    @Column({ type: DataType.DECIMAL(24, 12), allowNull: false })
    declare stickerUnitCost: number

    @Column({ type: DataType.DECIMAL(14, 6), allowNull: false })
    declare stickerQuantityPerCase: number

    @Column({ type: DataType.DECIMAL(24, 12), allowNull: false })
    declare secondStickerUnitCost: number

    @Column({ type: DataType.DECIMAL(14, 6), allowNull: false })
    declare secondStickerQuantityPerCase: number

    @Column({ type: DataType.DECIMAL(24, 12), allowNull: false })
    declare bottleUnitCost: number

    @Column({ type: DataType.DECIMAL(24, 12), allowNull: false })
    declare capUnitCost: number

    @Column({ type: DataType.DECIMAL(14, 4), allowNull: false })
    declare marginPerCase: number

    @BelongsTo(() => Juice, "juiceId")
    declare juice: Juice

}

export default JuicePresentation
