import { Table, Column, DataType } from "sequelize-typescript"
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel"
import { col, fn } from "sequelize"

@Table({
    tableName: "juiceSpiceMaterials",
    indexes: [{ name: "juiceSpiceMaterials_code_unique", unique: true, fields: [fn("lower", col("code"))] }],
})
class JuiceSpiceMaterial extends BaseCatalogModel {
    @Column({ type: DataType.STRING(60), allowNull: false })
    declare code: string

    @Column({ type: DataType.STRING(120), allowNull: false })
    declare displayName: string

    @Column({ type: DataType.DECIMAL(24, 12), allowNull: false })
    declare costPerGram: number

}

export default JuiceSpiceMaterial
