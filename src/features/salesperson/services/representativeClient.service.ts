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
            attributes: ["id", "name", "email", "isActive"], ...(activeOnly ? { where: { isActive: true } } : {}) }],
        order: [[{ model: Client, as: "client" }, "name", "ASC"], ["clientId", "ASC"]],
    })
    return rows.map(row => ({ id: row.client.id, name: row.client.name, email: row.client.email, isActive: row.client.isActive }))
}

async function list(representativeId: number) {
    await requireRepresentative(representativeId)
    return assignedClients(representativeId)
}

// Validates and adds the clients inside the caller's transaction (also used when creating the representative).
async function addClients(representativeId: number, clientIds: number[] | "all", transaction: Transaction) {
    // Deterministic lock order protects validation from concurrent deactivation/deletion.
    const clients = await Client.findAll({ where: clientIds === "all" ? { isActive: true } : { id: { [Op.in]: clientIds } },
        attributes: ["id", "isActive"], order: [["id", "ASC"]], transaction, lock: transaction.LOCK.SHARE })
    if (clientIds !== "all" && clients.length !== clientIds.length) throw new AppError(422, "errors.assignment_client_missing")
    if (clients.some(client => !client.isActive)) throw new AppError(422, "errors.assignment_inactive_client")
    // Additive, idempotent: another administrator's assignments are never overwritten.
    if (clients.length) await RepresentativeClient.bulkCreate(clients.map(client => ({ representativeId, clientId: client.id })),
        { transaction, ignoreDuplicates: true })
}

async function assignClients(representativeId: number, clientIds: number[] | "all") {
    return Salesperson.sequelize!.transaction(async transaction => {
        const representative = await requireRepresentative(representativeId, transaction)
        if (!representative.isActive) throw new AppError(422, "errors.assignment_inactive_representative")
        await addClients(representativeId, clientIds, transaction)
        return assignedClients(representativeId, transaction)
    })
}

const assign = (representativeId: number, clientIds: number[]) => assignClients(representativeId, clientIds)
const assignAll = (representativeId: number) => assignClients(representativeId, "all")

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
    return (await authorizedClients(representativeId)).map(client => client.id)
}

async function authorizedClients(representativeId: number) {
    const representative = await Salesperson.findOne({ where: { id: representativeId, isActive: true }, attributes: ["id"] })
    if (!representative) return []
    return assignedClients(representativeId, undefined, true)
}

export const representativeClientService = { list, assign, assignAll, remove, authorizedClientIds, authorizedClients, addClients }
