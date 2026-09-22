import bcrypt from "bcryptjs"
import { Op, WhereOptions } from "sequelize"
import { CreateSalespersonInput, UpdateSalespersonInput } from "../schemas/salesperson.schema"
import Salesperson from "../models/Salesperson.model"
import { NotFoundError } from "../../../shared/errors/AppError"
import { paginate, PaginatedResult, PaginationParams } from "../../../shared/utils/pagination.util"

const PASSWORD_SALT_ROUNDS = 10

// Devuelve activos e inactivos -- es la lista que consume el admin (SalespersonTable), que
// necesita ver los representantes desactivados para poder reactivarlos (mismo patrón en
// user.service.ts::listUsers / category.service.ts::listCategories).
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

async function createSalesperson(input: CreateSalespersonInput): Promise<Salesperson> {
    const hashedPassword = await bcrypt.hash(input.password, PASSWORD_SALT_ROUNDS)
    const salesperson = await Salesperson.create({ ...input, password: hashedPassword })
    return getSalespersonById(salesperson.id)
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

// Ver el mismo patrón en user.service.ts::setUserStatus / category.service.ts::setCategoryStatus
// -- busca sin filtrar por isActive para poder tanto desactivar como reactivar (getSalespersonById
// no sirve acá porque filtra isActive:true, y dejaría inalcanzable a un representante ya
// desactivado).
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
