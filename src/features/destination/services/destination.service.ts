import { Op, WhereOptions } from "sequelize"
import Destination from "../models/Destination.model"
import { NotFoundError } from "../../../shared/errors/AppError"
import { CreateDestinationInput, UpdateDestinationInput } from "../schemas/destination.schema"
import { paginate, PaginatedResult, PaginationParams } from "../../../shared/utils/pagination.util"

async function listDestinations(pagination?: PaginationParams, search?: string, country?: string): Promise<PaginatedResult<Destination>> {
    const where: WhereOptions = {
        isActive: true,
        ...(search ? { displayName: { [Op.iLike]: `%${search}%` } } : {}),
        ...(country ? { country } : {}),
    }
    return paginate(Destination, { where, order: [["displayName", "DESC"]] }, pagination)
}

async function getDestinationById(id: number): Promise<Destination> {
    const destination = await Destination.findOne({ where: { id, isActive: true } })
    if (!destination) throw new NotFoundError("Destination", id)
    return destination
}

async function createDestination(input: CreateDestinationInput): Promise<Destination> {
    return Destination.create(input)
}

async function updateDestination(id: number, input: UpdateDestinationInput): Promise<Destination> {
    const destination = await getDestinationById(id)
    return destination.update(input)
}

async function deleteDestination(id: number): Promise<void> {
    const destination = await getDestinationById(id)
    await destination.update({ isActive: false })
}

export const destinationService = {
    listDestinations,
    getDestinationById,
    createDestination,
    updateDestination,
    deleteDestination,
}
