import { Table, Column, DataType, HasMany } from "sequelize-typescript"
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel"
import Product from "../../product/models/Product.model"

@Table({
    tableName: "clients"
})
class Client extends BaseCatalogModel {
    @Column({
        type: DataType.STRING(100),
        allowNull: false
    })
    declare name: string

    @HasMany(() => Product, "clientId")
    declare products: Product[]
}

export default Client
