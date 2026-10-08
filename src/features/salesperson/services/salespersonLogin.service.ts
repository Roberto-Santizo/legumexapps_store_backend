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
    const salesperson = await Salesperson.findOne({ where: { email: input.email, isActive: true } })

    if (!salesperson) throw new AppError(401, "errors.invalid_credentials")

    if (isAccountLocked(salesperson)) {
        throw new AppError(423, "errors.account_locked")
    }

    const passwordMatches = await bcrypt.compare(input.password, salesperson.password)

    if (!passwordMatches) {
        await registerFailedAttempt(salesperson)
        throw new AppError(401, "errors.invalid_credentials")
    }

    await clearFailedAttempts(salesperson)

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
