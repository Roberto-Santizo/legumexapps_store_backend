import { Table, Column, DataType } from "sequelize-typescript"
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel"

@Table({
    tableName: "customers"
})
class Customer extends BaseCatalogModel {
    @Column({
        type: DataType.STRING(100),
        allowNull: false
    })
    declare name: string

    @Column({
        type: DataType.STRING(100),
        allowNull: true
    })
    declare companyName: string | null

    @Column({
        type: DataType.STRING,
        allowNull: false,
        unique: true
    })
    declare email: string

    @Column({
        type: DataType.STRING,
        allowNull: false
    })
    declare password: string

    @Column({
        type: DataType.INTEGER,
        defaultValue: 0
    })
    declare failed_attempts: number

    @Column({
        type: DataType.DATE,
        allowNull: true,
        defaultValue: null
    })
    declare locked_until: Date | null

    toJSON(): object {
        const values = { ...this.get() }
        delete values.password
        return values
    }
}

export default Customer
