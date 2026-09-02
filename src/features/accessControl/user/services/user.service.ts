import bcrypt from "bcryptjs"
import { Op, WhereOptions } from "sequelize"
import { CreateUserInput, UpdateUserInput } from "../schemas/user.schema";
import User from "../models/user.model"
import { NotFoundError } from "../../../../shared/errors/AppError";
import { paginate, PaginatedResult, PaginationParams } from "../../../../shared/utils/pagination.util";

const PASSWORD_SALT_ROUNDS = 10

async function listUsers(pagination?: PaginationParams, search?: string): Promise<PaginatedResult<User>> {
    const where: WhereOptions = search
        ? { [Op.or]: [{ name: { [Op.iLike]: `%${search}%` } }, { username: { [Op.iLike]: `%${search}%` } }] }
        : {}
    return paginate(
        User,
        { where, order: [["isActive", "DESC"], ["name", "DESC"]], attributes: { exclude: ["password"] } },
        pagination
    )
}

async function getUserById(id: number): Promise<User> {
    const user = await User.findOne({
        where: { id, isActive: true },
        attributes: { exclude: ["password"] }
    })
    if (!user) throw new NotFoundError("User", id)
    return user
}

async function createUser(input: CreateUserInput): Promise<User> {
    const hashedPassword = await bcrypt.hash(input.password, PASSWORD_SALT_ROUNDS)
    const user = await User.create({ ...input, password: hashedPassword })
    return getUserById(user.id)
}

async function updateUser(id: number, input: UpdateUserInput): Promise<User> {
    const user = await getUserById(id)
    const data = { ...input }
    if (data.password) {
        data.password = await bcrypt.hash(data.password, PASSWORD_SALT_ROUNDS)
    }
    await user.update(data)
    return getUserById(id)
}

async function deleteUser(id: number): Promise<void> {
    const user = await getUserById(id)
    await user.update({ isActive: false })
}


async function setUserStatus(id: number, isActive: boolean): Promise<User> {
    const user = await User.findOne({ where: { id }, attributes: { exclude: ["password"] } })
    if (!user) throw new NotFoundError("User", id)
    await user.update({ isActive })
    return user
}

export const userService = {
    listUsers,
    getUserById,
    createUser,
    updateUser,
    deleteUser,
    setUserStatus,
}
