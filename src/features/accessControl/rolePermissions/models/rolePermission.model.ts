import { Table, Column, Model, ForeignKey, DataType } from "sequelize-typescript";
import Role from "../../roles/models/role.model";
import Permission from "../../permissions/models/permission.model";

@Table({
    tableName: 'role_permissions',
    timestamps: false,
    indexes: [
        { unique: true, fields: ['role_id', 'permission_id'] }
    ]
})
class RolePermission extends Model {
    @ForeignKey(() => Role)
    @Column({ type: DataType.INTEGER })
    declare role_id: number

    @ForeignKey(() => Permission)
    @Column({ type: DataType.INTEGER })
    declare permission_id: number
}

export default RolePermission;
