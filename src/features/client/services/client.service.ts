import { Op, WhereOptions } from "sequelize"
import Client from "../models/Client.model"
import { NotFoundError } from "../../../shared/errors/AppError"
import { CreateClientInput, UpdateClientInput } from "../schemas/client.schema"
import { paginate, PaginatedResult, PaginationParams } from "../../../shared/utils/pagination.util"

async function listClients(pagination?: PaginationParams, search?: string): Promise<PaginatedResult<Client>> {
    const where: WhereOptions = search
        ? { [Op.or]: [{ name: { [Op.iLike]: `%${search}%` } }] }
        : {}
    return paginate(Client, { where, order: [["isActive", "DESC"], ["name", "DESC"]] }, pagination)
}

async function getClientById(id: number): Promise<Client> {
    const client = await Client.findOne({ where: { id, isActive: true } })
    if (!client) throw new NotFoundError("Client", id)
    return client
}

async function createClient(input: CreateClientInput): Promise<Client> {
    return Client.create(input)
}

async function updateClient(id: number, input: UpdateClientInput): Promise<Client> {
    const client = await getClientById(id)
    return client.update(input)
}


async function setClientStatus(id: number, isActive: boolean): Promise<Client> {
    const client = await Client.findOne({ where: { id } })
    if (!client) throw new NotFoundError("Client", id)
    await client.update({ isActive })
    return client
}

export const clientService = {
    listClients,
    getClientById,
    createClient,
    updateClient,
    setClientStatus,
}
