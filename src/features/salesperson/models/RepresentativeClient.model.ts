import { Table, Column, DataType, ForeignKey, BelongsTo, Model } from "sequelize-typescript"
import Salesperson from "./Salesperson.model"
import Client from "../../client/models/Client.model"

// Presence means assigned. No surrogate ID, soft-delete flag or nullable columns.
@Table({ tableName: "representative_clients", timestamps: false })
class RepresentativeClient extends Model {
    @ForeignKey(() => Salesperson)
    @Column({ type: DataType.INTEGER, primaryKey: true, allowNull: false })
    declare representativeId: number

    @ForeignKey(() => Client)
    @Column({ type: DataType.INTEGER, primaryKey: true, allowNull: false })
    declare clientId: number

    @BelongsTo(() => Salesperson, { foreignKey: "representativeId", onDelete: "RESTRICT", onUpdate: "CASCADE" })
    declare representative: Salesperson

    @BelongsTo(() => Client, { foreignKey: "clientId", onDelete: "RESTRICT", onUpdate: "CASCADE" })
    declare client: Client
}

export default RepresentativeClient
