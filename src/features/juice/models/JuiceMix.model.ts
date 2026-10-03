import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript"
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel"
import Juice from "./Juice.model"
import JuiceRawMaterial from "./JuiceRawMaterial.model"

@Table({
    tableName: "juiceMixes",
    indexes: [{ unique: true, fields: ["juiceId", "rawMaterialId"] }],
})
class JuiceMix extends BaseCatalogModel {
    @ForeignKey(() => Juice)
    @Column({ type: DataType.INTEGER, allowNull: false })
    declare juiceId: number

    @ForeignKey(() => JuiceRawMaterial)
    @Column({ type: DataType.INTEGER, allowNull: false })
    declare rawMaterialId: number

    @Column({ type: DataType.DECIMAL(14, 6), allowNull: false })
    declare percentage: number

    @BelongsTo(() => Juice, "juiceId")
    declare juice: Juice

    @BelongsTo(() => JuiceRawMaterial, "rawMaterialId")
    declare rawMaterial: JuiceRawMaterial

}

export default JuiceMix
