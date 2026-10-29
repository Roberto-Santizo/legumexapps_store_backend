import { Table, Column, DataType, HasMany, BelongsToMany } from "sequelize-typescript"
import Salesperson from "../../salesperson/models/Salesperson.model"
import RepresentativeClient from "../../salesperson/models/RepresentativeClient.model"
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel"
import Product from "../../product/models/Product.model"

@Table({
    tableName: "clients"
})
class Client extends BaseCatalogModel {
    @BelongsToMany(() => Salesperson, {
        through: () => RepresentativeClient,
        foreignKey: "clientId",
        otherKey: "representativeId",
        onDelete: "RESTRICT",
        onUpdate: "CASCADE"
    })
    declare representatives: Salesperson[]

    @Column({
        type: DataType.STRING(100),
        allowNull: false
    })
    declare name: string

    // Correo al que se envía la cotización aprobada. El representante lo agrega desde el pedido si falta;
    // un pedido puede ir a otro correo sin cambiar este (ver quoteOrderReviews.clientEmail).
    @Column({
        type: DataType.STRING(254),
        allowNull: true
    })
    declare email: string | null

    @HasMany(() => Product, "clientId")
    declare products: Product[]
}

export default Client
