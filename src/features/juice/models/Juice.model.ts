import { Table, Column, DataType, ForeignKey, BelongsTo, HasMany } from "sequelize-typescript"
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel"
import Client from "../../client/models/Client.model"
import JuicePresentation from "./JuicePresentation.model"
import JuiceMix from "./JuiceMix.model"
import JuiceSpice from "./JuiceSpice.model"
import { col, fn } from "sequelize"

@Table({
    tableName: "juices",
    indexes: [{ name: "juices_code_unique", unique: true, fields: [fn("lower", col("code"))] }, { unique: true, fields: ["urlSlug"] }],
})
class Juice extends BaseCatalogModel {
    @Column({ type: DataType.STRING(60), allowNull: false })
    declare code: string

    @Column({ type: DataType.STRING(120), allowNull: false })
    declare displayName: string

    @Column({ type: DataType.STRING(120), allowNull: false })
    declare urlSlug: string

    @ForeignKey(() => Client)
    @Column({ type: DataType.INTEGER, allowNull: false })
    declare clientId: number

    @Column({ type: DataType.DECIMAL(24, 12), allowNull: false })
    declare pricePerPound: number

    @Column({ type: DataType.STRING(255), allowNull: true })
    declare imageUrl: string | null

    @BelongsTo(() => Client, "clientId")
    declare client: Client

    @HasMany(() => JuicePresentation, "juiceId")
    declare presentations: JuicePresentation[]

    @HasMany(() => JuiceMix, "juiceId")
    declare mix: JuiceMix[]

    @HasMany(() => JuiceSpice, "juiceId")
    declare spices: JuiceSpice[]

}

export default Juice
