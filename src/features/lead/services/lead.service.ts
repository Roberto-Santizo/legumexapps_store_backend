import { Op, WhereOptions } from "sequelize"
import Lead from "../models/Lead.model"
import { NotFoundError } from "../../../shared/errors/AppError"
import { PublicCreateLeadInput, UpdateLeadInput, LeadQuery } from "../schemas/lead.schema"
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

async function getLeadById(id: number): Promise<Lead> {
    const lead = await Lead.findOne({ where: { id } })
    if (!lead) throw new NotFoundError("Lead", id)
    return lead
}

async function updateLead(id: number, input: UpdateLeadInput): Promise<Lead> {
    const lead = await getLeadById(id)
    return lead.update(input)
}

export const leadService = {
    createLead,
    listLeads,
    getLeadById,
    updateLead,
}
