import bcrypt from "bcryptjs"
import { Op, WhereOptions } from "sequelize"
import { CreateSalespersonInput, UpdateSalespersonInput } from "../schemas/salesperson.schema"
import Salesperson from "../models/Salesperson.model"
import { NotFoundError } from "../../../shared/errors/AppError"
import { paginate, PaginatedResult, PaginationParams } from "../../../shared/utils/pagination.util"
import { representativeClientService } from "./representativeClient.service"

const PASSWORD_SALT_ROUNDS = 10

// Devuelve activos e inactivos: el admin necesita ver los representantes desactivados para
// reactivarlos.
async function listSalespeople(pagination?: PaginationParams, search?: string): Promise<PaginatedResult<Salesperson>> {
    const where: WhereOptions = search
        ? { [Op.or]: [{ name: { [Op.iLike]: `%${search}%` } }, { email: { [Op.iLike]: `%${search}%` } }] }
        : {}
    return paginate(
        Salesperson,
        { where, order: [["isActive", "DESC"], ["name", "DESC"]], attributes: { exclude: ["password"] } },
        pagination
    )
}

async function getSalespersonById(id: number): Promise<Salesperson> {
    const salesperson = await Salesperson.findOne({
        where: { id, isActive: true },
        attributes: { exclude: ["password"] }
    })
    if (!salesperson) throw new NotFoundError("Salesperson", id)
    return salesperson
}

// The representative and its initial clients are saved together: if a client is invalid, nothing is created.
async function createSalesperson(input: CreateSalespersonInput): Promise<Salesperson> {
    const { clientIds, assignAllClients, ...fields } = input
    const hashedPassword = await bcrypt.hash(fields.password, PASSWORD_SALT_ROUNDS)
    const id = await Salesperson.sequelize!.transaction(async transaction => {
        const salesperson = await Salesperson.create({ ...fields, password: hashedPassword }, { transaction })
        const clients = assignAllClients ? "all" : clientIds
        if (clients) await representativeClientService.addClients(salesperson.id, clients, transaction)
        return salesperson.id
    })
    return getSalespersonById(id)
}

async function updateSalesperson(id: number, input: UpdateSalespersonInput): Promise<Salesperson> {
    const salesperson = await getSalespersonById(id)
    const data = { ...input }
    if (data.password) {
        data.password = await bcrypt.hash(data.password, PASSWORD_SALT_ROUNDS)
    }
    await salesperson.update(data)
    return getSalespersonById(id)
}

async function deleteSalesperson(id: number): Promise<void> {
    const salesperson = await getSalespersonById(id)
    await salesperson.update({ isActive: false })
}

// Busca sin filtrar por isActive para poder tanto desactivar como reactivar (getSalespersonById
// filtra isActive:true).
async function setSalespersonStatus(id: number, isActive: boolean): Promise<Salesperson> {
    const salesperson = await Salesperson.findOne({ where: { id }, attributes: { exclude: ["password"] } })
    if (!salesperson) throw new NotFoundError("Salesperson", id)
    await salesperson.update({ isActive })
    return salesperson
}

export const salespersonService = {
    listSalespeople,
    getSalespersonById,
    createSalesperson,
    updateSalesperson,
    deleteSalesperson,
    setSalespersonStatus,
}
