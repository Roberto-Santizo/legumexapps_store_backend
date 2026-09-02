import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { env } from "../../../../config/env"
import { AppError } from "../../../../shared/errors/AppError"
import { clearFailedAttempts, isAccountLocked, registerFailedAttempt } from "../../../../shared/services/accountLockout.service"
import User from "../../user/models/user.model"
import Role from "../../roles/models/role.model"
import Permission from "../../permissions/models/permission.model"
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
    // Single round trip: user + role + permissions, so the JWT carries everything
    // authorize() needs and no further access-control queries happen on later requests.
    const user = await User.findOne({
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

    if (!user) throw new AppError(401, "errors.invalid_credentials")

    if (isAccountLocked(user)) {
        throw new AppError(423, "errors.account_locked")
    }

    const passwordMatches = await bcrypt.compare(input.password, user.password)

    if (!passwordMatches) {
        await registerFailedAttempt(user)
        throw new AppError(401, "errors.invalid_credentials")
    }

    await clearFailedAttempts(user)

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
