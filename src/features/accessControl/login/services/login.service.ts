import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { env } from "../../../../config/env"
import { AppError } from "../../../../shared/errors/AppError"
import { clearFailedAttempts, isAccountLocked, registerFailedAttempt } from "../../../../shared/services/accountLockout.service"
import User from "../../user/models/User.model"
import Role from "../../roles/models/Role.model"
import Permission from "../../permissions/models/Permission.model"
import { LoginInput } from "../schemas/login.schema"

interface LoginResult {
    token: string
    user: {
        id: number
        name: string
        username: string
        role: string
        permissions: string[]
    }
}

async function login(input: LoginInput): Promise<LoginResult> {
    const user = await User.sequelize!.transaction(async transaction => {
        const account = await User.findOne({
            transaction,
            lock: { level: transaction.LOCK.UPDATE, of: User },
            where: { username: input.username, isActive: true },
            include: [{
                model: Role,
                required: true,
                where: { isActive: true },
                include: [{
                    model: Permission,
                    required: false,
                    where: { isActive: true },
                    attributes: ["name"]
                }]
            }]
        })

        if (!account) return null

        if (isAccountLocked(account)) {
            throw new AppError(423, "errors.account_locked")
        }

        const passwordMatches = await bcrypt.compare(input.password, account.password)

        if (!passwordMatches) {
            // Commit the failed attempt before returning the authentication error outside the transaction.
            await registerFailedAttempt(account, transaction)
            return null
        }

        await clearFailedAttempts(account, transaction)

        return account
    })
    if (!user) throw new AppError(401, "errors.invalid_credentials")

    const permissions = user.role.permissions.map(permission => permission.name)

    const token = jwt.sign(
        { sub: user.id, type: "staff", roleId: user.role_id, roleName: user.role.name, permissions },
        env.jwtSecret,
        { expiresIn: env.jwtExpiresIn } as jwt.SignOptions
    )

    return {
        token,
        user: {
            id: user.id,
            name: user.name,
            username: user.username,
            role: user.role.name,
            permissions
        }
    }
}

export const authService = {
    login
}
