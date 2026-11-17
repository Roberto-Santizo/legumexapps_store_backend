import { Table, Column, DataType, ForeignKey, BelongsTo, HasMany } from "sequelize-typescript"
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel"
import LaborTemplateLine from "./LaborTemplateLine.model"
import LaborTemplatePosition from "./LaborTemplatePosition.model"
import type { LaborBenefit } from "../schemas/laborTemplate.schema"

@Table({
    tableName: "laborTemplates"
})
class LaborTemplate extends BaseCatalogModel {
    @Column({
        type: DataType.STRING(60),
        allowNull: false,
        unique: true
    })
    declare code: string

    @Column({
        type: DataType.STRING(160),
        allowNull: false
    })
    declare displayName: string

    @ForeignKey(() => LaborTemplateLine)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare lineId: number

    @BelongsTo(() => LaborTemplateLine, {
        foreignKey: "lineId",
        onDelete: "RESTRICT"
    })
    declare line: LaborTemplateLine

    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare daysPerYear: number

    @Column({
        type: DataType.DECIMAL(7, 4),
        allowNull: false
    })
    declare weeklyHours: number

    @Column({
        type: DataType.JSONB,
        allowNull: false
    })
    declare benefits: LaborBenefit[]

    @Column({
        type: DataType.DATEONLY,
        allowNull: false
    })
    declare effectiveFrom: string

    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare revision: number

    @Column({
        type: DataType.DECIMAL(24, 12),
        allowNull: false
    })
    declare hourlyCostGtq: number

    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare includedPositions: number

    @HasMany(() => LaborTemplatePosition, {
        foreignKey: "templateId",
        onDelete: "RESTRICT"
    })
    declare positions: LaborTemplatePosition[]
}

export default LaborTemplate
