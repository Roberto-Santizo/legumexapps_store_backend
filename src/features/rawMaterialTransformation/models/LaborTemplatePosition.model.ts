import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript"
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel"
import LaborTemplate from "./LaborTemplate.model"

@Table({
    tableName: "laborTemplatePositions",
    indexes: [
        {
            name: "laborTemplatePositions_template_code_unique",
            unique: true,
            fields: ["templateId", "code"]
        }
    ]
})
class LaborTemplatePosition extends BaseCatalogModel {
    @ForeignKey(() => LaborTemplate)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare templateId: number

    @BelongsTo(() => LaborTemplate, {
        foreignKey: "templateId",
        onDelete: "RESTRICT"
    })
    declare template: LaborTemplate

    @Column({
        type: DataType.STRING(60),
        allowNull: false
    })
    declare code: string

    @Column({
        type: DataType.STRING(160),
        allowNull: false
    })
    declare jobTitle: string

    @Column({
        type: DataType.DECIMAL(14, 2),
        allowNull: false
    })
    declare salaryMonthlyGtq: number

    @Column({
        type: DataType.DECIMAL(14, 2),
        allowNull: false
    })
    declare bonusMonthlyGtq: number

    @Column({
        type: DataType.JSONB,
        allowNull: false
    })
    declare applicableBenefitCodes: string[]

    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare sortOrder: number
}

export default LaborTemplatePosition
