import { Table, Column, DataType, ForeignKey, BelongsTo } from "sequelize-typescript"
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel"
import Juice from "./Juice.model"
import JuiceSpiceMaterial from "./JuiceSpiceMaterial.model"

@Table({
    tableName: "juiceSpices",
    indexes: [{ unique: true, fields: ["juiceId", "spiceMaterialId"] }],
})
class JuiceSpice extends BaseCatalogModel {
    @ForeignKey(() => Juice)
    @Column({ type: DataType.INTEGER, allowNull: false })
    declare juiceId: number

    @ForeignKey(() => JuiceSpiceMaterial)
    @Column({ type: DataType.INTEGER, allowNull: false })
    declare spiceMaterialId: number

    @Column({ type: DataType.DECIMAL(14, 6), allowNull: false })
    declare gramsPerLiter: number

    @BelongsTo(() => Juice, "juiceId")
    declare juice: Juice

    @BelongsTo(() => JuiceSpiceMaterial, "spiceMaterialId")
    declare spiceMaterial: JuiceSpiceMaterial

}

export default JuiceSpice
