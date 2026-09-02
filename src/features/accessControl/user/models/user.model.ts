import { Table, Column, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript'
import Role from '../../roles/models/role.model'
import BaseCatalogModel from '../../../../shared/base-model/BaseCatalogModel'

@Table({
    tableName: 'users'
})
class User extends BaseCatalogModel {
    @Column({
        type: DataType.STRING(100),
    })
    declare name: string

    @Column({
        type: DataType.STRING,
        unique: true
    })
    declare username: string

    @Column({
        type: DataType.STRING,
    })
    declare password: string

    @ForeignKey(() => Role)
    @Column({
        type: DataType.INTEGER,
    })
    declare role_id: number

    @BelongsTo(() => Role)
    declare role: Role

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

export default User;
