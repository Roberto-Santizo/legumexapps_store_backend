import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { env } from "../../../config/env"
import { AppError } from "../../../shared/errors/AppError"
import { clearFailedAttempts, isAccountLocked, registerFailedAttempt } from "../../../shared/services/accountLockout.service"
import Salesperson from "../models/Salesperson.model"
import { SalespersonLoginInput } from "../schemas/salespersonLogin.schema"

interface SalespersonLoginResult {
    token: string
    salesperson: {
        id: number
        name: string
        companyName: string | null
        email: string
    }
}

async function login(input: SalespersonLoginInput): Promise<SalespersonLoginResult> {
    const salesperson = await Salesperson.sequelize!.transaction(async transaction => {
        const account = await Salesperson.findOne({ where: { email: input.email, isActive: true }, transaction, lock: transaction.LOCK.UPDATE })

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
    if (!salesperson) throw new AppError(401, "errors.invalid_credentials")

    // type se queda literal "customer" a propósito: es el valor que ya llevan los JWT emitidos y
    // cambiarlo invalidaría toda sesión activa. authenticateSalesperson.ts compara contra este literal.
    const token = jwt.sign(
        { sub: salesperson.id, type: "customer" },
        env.jwtSecret,
        { expiresIn: env.jwtExpiresIn } as jwt.SignOptions
    )

    return {
        token,
        salesperson: {
            id: salesperson.id,
            name: salesperson.name,
            companyName: salesperson.companyName,
            email: salesperson.email
        }
    }
}

export const salespersonLoginService = {
    login
}
