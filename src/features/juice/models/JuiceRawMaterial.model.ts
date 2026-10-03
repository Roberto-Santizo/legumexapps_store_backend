import { Table, Column, DataType } from "sequelize-typescript"
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel"
import { col, fn } from "sequelize"

@Table({
    tableName: "juiceRawMaterials",
    indexes: [{ name: "juiceRawMaterials_code_unique", unique: true, fields: [fn("lower", col("code"))] }],
})
class JuiceRawMaterial extends BaseCatalogModel {
    @Column({ type: DataType.STRING(60), allowNull: false })
    declare code: string

    @Column({ type: DataType.STRING(120), allowNull: false })
    declare displayName: string

    @Column({ type: DataType.ENUM("LIBRA", "LITRO", "GRAMO"), allowNull: false })
    declare purchaseUnit: string

    @Column({ type: DataType.DECIMAL(14, 6), allowNull: false })
    declare yieldPoundsPerLiter: number

    @Column({ type: DataType.DECIMAL(24, 12), allowNull: false })
    declare costPerUnit: number

    @Column({ type: DataType.DECIMAL(24, 12), allowNull: false })
    declare costPerLiter: number

}

export default JuiceRawMaterial
