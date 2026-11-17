import { Table, Column, DataType, ForeignKey, BelongsTo, Model } from "sequelize-typescript"
import LaborTemplate from "./LaborTemplate.model"
import User from "../../accessControl/user/models/User.model"
import type { SaveLaborTemplateInput, SaveLaborLineInput } from "../schemas/laborTemplate.schema"
import type { LaborCalculationResult } from "../services/laborTemplateCalculation"

export interface LaborRevisionSnapshot {
    input: SaveLaborTemplateInput
    line: Omit<SaveLaborLineInput, "expectedVersion"> & { revision: number }
    calculation: LaborCalculationResult
}

@Table({
    tableName: "laborTemplateRevisions",
    updatedAt: false,
    indexes: [
        {
            name: "laborTemplateRevisions_template_version_unique",
            unique: true,
            fields: ["templateId", "revision"]
        }
    ]
})
class LaborTemplateRevision extends Model {
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
        type: DataType.INTEGER,
        allowNull: false
    })
    declare revision: number

    @ForeignKey(() => User)
    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare createdByUserId: number

    @BelongsTo(() => User, {
        foreignKey: "createdByUserId",
        onDelete: "RESTRICT"
    })
    declare createdByUser: User

    @Column({
        type: DataType.DATEONLY,
        allowNull: false
    })
    declare effectiveFrom: string

    @Column({
        type: DataType.STRING(500),
        allowNull: false
    })
    declare changeReason: string

    @Column({
        type: DataType.JSONB,
        allowNull: false
    })
    declare snapshot: LaborRevisionSnapshot
}

export default LaborTemplateRevision
