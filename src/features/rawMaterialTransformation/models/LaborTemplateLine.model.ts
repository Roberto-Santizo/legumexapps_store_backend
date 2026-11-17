import { Table, Column, DataType } from "sequelize-typescript"
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel"
import type { LaborLinePosition } from "../schemas/laborTemplate.schema"

@Table({
    tableName: "laborTemplateLines"
})
class LaborTemplateLine extends BaseCatalogModel {
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

    @Column({
        type: DataType.STRING(160),
        allowNull: false
    })
    declare plantName: string

    @Column({
        type: DataType.STRING(2),
        allowNull: false
    })
    declare shift: "AM" | "PM"

    // Reference positions only; salaries belong to each cost template.
    @Column({
        type: DataType.JSONB,
        allowNull: false
    })
    declare positions: LaborLinePosition[]

    @Column({
        type: DataType.INTEGER,
        allowNull: false
    })
    declare revision: number
}

export default LaborTemplateLine
