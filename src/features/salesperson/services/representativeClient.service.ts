import type { Transaction } from "sequelize"
import { Op } from "sequelize"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import Client from "../../client/models/Client.model"
import Salesperson from "../models/Salesperson.model"
import RepresentativeClient from "../models/RepresentativeClient.model"

async function requireRepresentative(id: number, transaction?: Transaction, activeOnly = false) {
    const representative = await Salesperson.findOne({
        where: { id, ...(activeOnly ? { isActive: true } : {}) },
        attributes: ["id", "isActive"], transaction,
        ...(transaction ? { lock: transaction.LOCK.UPDATE } : {}),
    })
    if (!representative) throw new NotFoundError("Salesperson", id)
    return representative
}

async function assignedClients(representativeId: number, transaction?: Transaction, activeOnly = false) {
    const rows = await RepresentativeClient.findAll({
        where: { representativeId }, transaction,
        include: [{ model: Client, as: "client", required: true,
            attributes: ["id", "name", "isActive"], ...(activeOnly ? { where: { isActive: true } } : {}) }],
        order: [[{ model: Client, as: "client" }, "name", "ASC"], ["clientId", "ASC"]],
    })
    return rows.map(row => ({ id: row.client.id, name: row.client.name, isActive: row.client.isActive }))
}

async function list(representativeId: number) {
    await requireRepresentative(representativeId)
    return assignedClients(representativeId)
}

async function assign(representativeId: number, clientIds: number[]) {
    return Salesperson.sequelize!.transaction(async transaction => {
        const representative = await requireRepresentative(representativeId, transaction)
        if (!representative.isActive) throw new AppError(422, "errors.assignment_inactive_representative")
        // Deterministic lock order protects validation from concurrent deactivation/deletion.
        const clients = await Client.findAll({ where: { id: { [Op.in]: clientIds } },
            attributes: ["id", "isActive"], order: [["id", "ASC"]], transaction, lock: transaction.LOCK.SHARE })
        if (clients.length !== clientIds.length) throw new AppError(422, "errors.assignment_client_missing")
        if (clients.some(client => !client.isActive)) throw new AppError(422, "errors.assignment_inactive_client")
        // Additive, idempotent: another administrator's assignments are never overwritten.
        await RepresentativeClient.bulkCreate(clientIds.map(clientId => ({ representativeId, clientId })),
            { transaction, ignoreDuplicates: true })
        return assignedClients(representativeId, transaction)
    })
}

async function remove(representativeId: number, clientId: number) {
    return Salesperson.sequelize!.transaction(async transaction => {
        await requireRepresentative(representativeId, transaction)
        const client = await Client.findByPk(clientId, { attributes: ["id"], transaction, lock: transaction.LOCK.SHARE })
        if (!client) throw new NotFoundError("Client", clientId)
        // Only this explicit pair is removed. Retrying a completed removal is harmless.
        await RepresentativeClient.destroy({ where: { representativeId, clientId }, transaction })
        return assignedClients(representativeId, transaction)
    })
}

// Future quote services can call this on every request; no JWT or process cache involved.
async function authorizedClientIds(representativeId: number): Promise<number[]> {
    const representative = await Salesperson.findOne({ where: { id: representativeId, isActive: true }, attributes: ["id"] })
    if (!representative) return []
    return (await assignedClients(representativeId, undefined, true)).map(client => client.id)
}

export const representativeClientService = { list, assign, remove, authorizedClientIds }
