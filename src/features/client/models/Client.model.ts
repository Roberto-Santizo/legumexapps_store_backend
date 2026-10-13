import { Table, Column, DataType, HasMany, BelongsToMany } from "sequelize-typescript"
import Salesperson from "../../salesperson/models/Salesperson.model"
import RepresentativeClient from "../../salesperson/models/RepresentativeClient.model"
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel"
import Product from "../../product/models/Product.model"

@Table({
    tableName: "clients"
})
class Client extends BaseCatalogModel {
    @BelongsToMany(() => Salesperson, { through: () => RepresentativeClient, foreignKey: "clientId", otherKey: "representativeId", onDelete: "RESTRICT", onUpdate: "CASCADE" })
    declare representatives: Salesperson[]

    @Column({
        type: DataType.STRING(100),
        allowNull: false
    })
    declare name: string

    @HasMany(() => Product, "clientId")
    declare products: Product[]
}

export default Client
