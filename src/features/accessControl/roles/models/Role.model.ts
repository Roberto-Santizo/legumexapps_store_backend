import { Table, Column, DataType, HasMany, BelongsToMany } from "sequelize-typescript";
import User from "../../user/models/User.model";
import Permission from "../../permissions/models/Permission.model";
import RolePermission from "../../rolePermissions/models/RolePermission.model";
import BaseCatalogModel from "../../../../shared/base-model/BaseCatalogModel";

@Table({
    tableName: 'roles'
})

class Role extends BaseCatalogModel {
    @Column({
        type: DataType.STRING(100),
        unique: true
    })
    declare name: string

    @HasMany(() => User)
    declare users: User[]

    @BelongsToMany(() => Permission, () => RolePermission)
    declare permissions: Permission[]
}

export default Role;