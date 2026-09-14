import { Op, WhereOptions } from "sequelize"
import Lead from "../models/Lead.model"
import Quote from "../../quote/models/Quote.model"
import { NotFoundError } from "../../../shared/errors/AppError"
import { PublicCreateLeadInput, QuoteLeadContactInput, UpdateLeadInput, LeadQuery } from "../schemas/lead.schema"
import { paginate, PaginatedResult, PaginationParams } from "../../../shared/utils/pagination.util"

export type CreateLeadData = Omit<PublicCreateLeadInput, "website">

async function createLead(input: CreateLeadData): Promise<Lead> {
    return Lead.create(input)
}

async function listLeads(pagination?: PaginationParams, search?: string, status?: LeadQuery["status"]): Promise<PaginatedResult<Lead>> {
    const where: WhereOptions = {
        ...(search
            ? {
                  [Op.or]: [
                      { fullName: { [Op.iLike]: `%${search}%` } },
                      { companyName: { [Op.iLike]: `%${search}%` } },
                      { email: { [Op.iLike]: `%${search}%` } },
                  ],
              }
            : {}),
        ...(status ? { status } : {}),
    }
    return paginate(Lead, { where, order: [["createdAt", "DESC"]] }, pagination)
}

// Incluye las cotizaciones vinculadas (Quote.leadId, ver Quote.model.ts) para que el panel de
// prospectos pueda mostrar "estas son las cotizaciones de este prospecto" (2026-09-13). Atributos
// acotados a propósito -- ni `breakdown` (JSONB pesado) ni las columnas de costo por línea, que
// no hacen falta para una lista de referencia; el detalle completo de una Quote puntual sigue
// viviendo en AdminQuoteListPage (GET /admin/quotes), no acá.
async function getLeadById(id: number): Promise<Lead> {
    const lead = await Lead.findOne({
        where: { id },
        include: [{
            model: Quote,
            as: "quotes",
            attributes: ["id", "productDisplayName", "variantLabel", "totalCost", "requestedPallets", "createdAt"],
            order: [["createdAt", "DESC"]]
        }]
    })
    if (!lead) throw new NotFoundError("Lead", id)
    return lead
}

async function updateLead(id: number, input: UpdateLeadInput): Promise<Lead> {
    const lead = await getLeadById(id)
    return lead.update(input)
}

// Regla de creación-o-reuso (2026-09-13, a pedido explícito del usuario): un mismo prospecto
// puede volver a cotizar más de una vez -- se busca por email EXACTO case-insensitive (Op.iLike,
// mismo criterio que product.service.ts::assertCodigoIsUnique) y, si ya existe, se REUSA tal cual
// está (no se sobreescribe fullName/companyName/notes/status) para no pisar en silencio algo que
// el admin ya haya editado en el panel de prospectos (ej. status "contacted", notas propias). Si
// no existe, se crea uno nuevo con los datos capturados en el cotizador -- phone/
// productLineInterest quedan null, ese origen no los captura (ver Lead.model.ts).
async function findOrCreateLeadForQuote(contact: QuoteLeadContactInput): Promise<Lead> {
    const existing = await Lead.findOne({ where: { email: { [Op.iLike]: contact.email } } })
    if (existing) return existing

    return Lead.create({
        fullName: contact.fullName,
        companyName: contact.companyName,
        email: contact.email,
        notes: contact.notes ?? null,
        phone: null,
        productLineInterest: null,
    })
}

export const leadService = {
    createLead,
    listLeads,
    getLeadById,
    updateLead,
    findOrCreateLeadForQuote,
}
