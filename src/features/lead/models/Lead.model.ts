import { Table, Column, DataType, Model, HasMany } from "sequelize-typescript";
import Quote from "../../quote/models/Quote.model";

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

    // Pasó de requerido a opcional (2026-09-13, mismo criterio ya usado en este repo para
    // relajar un NOT NULL sobre una tabla poblada -- ver Quote.destinationId): el cotizador de
    // clientes ahora TAMBIÉN crea Leads (ver quoteService.saveQuote / leadService.
    // findOrCreateLeadForQuote), y ese origen no captura teléfono. El formulario público de la
    // landing (leadCaptureSchema/publicCreateLeadSchema) lo sigue pidiendo como requerido a nivel
    // de ESE schema -- solo la columna física se relaja para admitir ambos orígenes.
    @Column({
        type: DataType.STRING(30),
        allowNull: true
    })
    declare phone: string | null

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

    // Cotizaciones vinculadas a este prospecto (2026-09-13, ver Quote.leadId) -- un Lead puede
    // acumular varias si el mismo email vuelve a cotizar (ver
    // leadService.findOrCreateLeadForQuote, que reusa el Lead existente en vez de duplicarlo).
    @HasMany(() => Quote, "leadId")
    declare quotes: Quote[]
}

export default Lead;
