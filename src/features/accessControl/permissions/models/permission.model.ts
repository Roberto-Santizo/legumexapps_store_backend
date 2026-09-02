import { Table, Column, DataType, BelongsToMany } from "sequelize-typescript";
import Role from "../../roles/models/role.model";
import RolePermission from "../../rolePermissions/models/rolePermission.model";
import BaseCatalogModel from "../../../../shared/base-model/BaseCatalogModel";

@Table({
    tableName: 'permissions'
})
class Permission extends BaseCatalogModel {
    @Column({
        type: DataType.STRING(100),
        unique: true
    })
    declare name: string

    @Column({
        type: DataType.STRING(200),
        allowNull: true
    })
    declare description: string

    @BelongsToMany(() => Role, () => RolePermission)
    declare roles: Role[]
}

export default Permission;
