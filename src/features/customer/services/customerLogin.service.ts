import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { env } from "../../../config/env"
import { AppError } from "../../../shared/errors/AppError"
import { clearFailedAttempts, isAccountLocked, registerFailedAttempt } from "../../../shared/services/accountLockout.service"
import Customer from "../models/Customer.model"
import { CustomerLoginInput } from "../schemas/customerLogin.schema"

interface CustomerLoginResult {
    token: string
    customer: {
        id: number
        name: string
        companyName: string | null
        email: string
    }
}

async function login(input: CustomerLoginInput): Promise<CustomerLoginResult> {
    const customer = await Customer.findOne({ where: { email: input.email, isActive: true } })

    if (!customer) throw new AppError(401, "errors.invalid_credentials")

    if (isAccountLocked(customer)) {
        throw new AppError(423, "errors.account_locked")
    }

    const passwordMatches = await bcrypt.compare(input.password, customer.password)

    if (!passwordMatches) {
        await registerFailedAttempt(customer)
        throw new AppError(401, "errors.invalid_credentials")
    }

    await clearFailedAttempts(customer)

    const token = jwt.sign(
        { sub: customer.id, type: "customer" },
        env.jwtSecret,
        { expiresIn: env.jwtExpiresIn } as jwt.SignOptions
    )

    return {
        token,
        customer: {
            id: customer.id,
            name: customer.name,
            companyName: customer.companyName,
            email: customer.email
        }
    }
}

export const customerLoginService = {
    login
}
