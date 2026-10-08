import { Table, Column, DataType } from "sequelize-typescript"
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel"

@Table({ tableName: "packagingGroups" })
export default class PackagingGroup extends BaseCatalogModel {
    @Column({ type: DataType.STRING(60), allowNull: false })
    declare displayName: string

    @Column({ type: DataType.STRING(60), allowNull: false, unique: true })
    declare nameKey: string
}
