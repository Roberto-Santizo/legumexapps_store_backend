import { Table, Column, DataType, Model } from "sequelize-typescript";

// Leads capturados desde el formulario público de la landing (ver feature/home del frontend).
// A propósito NO extiende BaseCatalogModel: un lead no tiene concepto de "activo/inactivo" (no
// se desactiva, se le cambia el status), así que esa columna no aplicaría acá.
export const LEAD_STATUSES = ["new", "contacted"] as const;
export type LeadStatus = typeof LEAD_STATUSES[number];

@Table({
    tableName: "leads"
})
class Lead extends Model {
    @Column({
        type: DataType.STRING(150),
        allowNull: false
    })
    declare fullName: string

    @Column({
        type: DataType.STRING(150),
        allowNull: false
    })
    declare companyName: string

    @Column({
        type: DataType.STRING(30),
        allowNull: false
    })
    declare phone: string

    @Column({
        type: DataType.STRING(150),
        allowNull: false
    })
    declare email: string

    @Column({
        type: DataType.STRING(120),
        allowNull: true
    })
    declare productLineInterest: string | null

    @Column({
        type: DataType.TEXT,
        allowNull: true
    })
    declare notes: string | null

    @Column({
        type: DataType.ENUM(...LEAD_STATUSES),
        allowNull: false,
        defaultValue: "new"
    })
    declare status: LeadStatus
}

export default Lead;
