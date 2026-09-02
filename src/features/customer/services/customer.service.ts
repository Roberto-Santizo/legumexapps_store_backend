import bcrypt from "bcryptjs"
import { Op, WhereOptions } from "sequelize"
import { CreateCustomerInput, UpdateCustomerInput } from "../schemas/customer.schema"
import Customer from "../models/Customer.model"
import { NotFoundError } from "../../../shared/errors/AppError"
import { paginate, PaginatedResult, PaginationParams } from "../../../shared/utils/pagination.util"

const PASSWORD_SALT_ROUNDS = 10

// Devuelve activos e inactivos -- es la lista que consume el admin (CustomerTable), que necesita
// ver los clientes desactivados para poder reactivarlos (ver mismo patrón en
// user.service.ts::listUsers / category.service.ts::listCategories).
async function listCustomers(pagination?: PaginationParams, search?: string): Promise<PaginatedResult<Customer>> {
    const where: WhereOptions = search
        ? { [Op.or]: [{ name: { [Op.iLike]: `%${search}%` } }, { email: { [Op.iLike]: `%${search}%` } }] }
        : {}
    return paginate(
        Customer,
        { where, order: [["isActive", "DESC"], ["name", "DESC"]], attributes: { exclude: ["password"] } },
        pagination
    )
}

async function getCustomerById(id: number): Promise<Customer> {
    const customer = await Customer.findOne({
        where: { id, isActive: true },
        attributes: { exclude: ["password"] }
    })
    if (!customer) throw new NotFoundError("Customer", id)
    return customer
}

async function createCustomer(input: CreateCustomerInput): Promise<Customer> {
    const hashedPassword = await bcrypt.hash(input.password, PASSWORD_SALT_ROUNDS)
    const customer = await Customer.create({ ...input, password: hashedPassword })
    return getCustomerById(customer.id)
}

async function updateCustomer(id: number, input: UpdateCustomerInput): Promise<Customer> {
    const customer = await getCustomerById(id)
    const data = { ...input }
    if (data.password) {
        data.password = await bcrypt.hash(data.password, PASSWORD_SALT_ROUNDS)
    }
    await customer.update(data)
    return getCustomerById(id)
}

async function deleteCustomer(id: number): Promise<void> {
    const customer = await getCustomerById(id)
    await customer.update({ isActive: false })
}

// Ver el mismo patrón en user.service.ts::setUserStatus / category.service.ts::setCategoryStatus
// -- busca sin filtrar por isActive para poder tanto desactivar como reactivar (getCustomerById
// no sirve acá porque filtra isActive:true, y dejaría inalcanzable a un cliente ya desactivado).
async function setCustomerStatus(id: number, isActive: boolean): Promise<Customer> {
    const customer = await Customer.findOne({ where: { id }, attributes: { exclude: ["password"] } })
    if (!customer) throw new NotFoundError("Customer", id)
    await customer.update({ isActive })
    return customer
}

export const customerService = {
    listCustomers,
    getCustomerById,
    createCustomer,
    updateCustomer,
    deleteCustomer,
    setCustomerStatus,
}
