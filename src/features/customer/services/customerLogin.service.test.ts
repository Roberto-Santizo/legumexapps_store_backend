// Mismo criterio que login.service.test.ts: no se mockea accountLockout.service, corre
// integrado con la lógica real de bloqueo (que ya tiene su propia suite exhaustiva aparte).
jest.mock("../models/Customer.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}))
jest.mock("bcryptjs", () => ({
    __esModule: true,
    default: { compare: jest.fn() }
}))
jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))

import jwt from "jsonwebtoken"
import bcrypt from "bcryptjs"
import Customer from "../models/Customer.model"
import { customerLoginService } from "./customerLogin.service"

const mockFindOne = Customer.findOne as unknown as jest.Mock
const mockCompare = bcrypt.compare as unknown as jest.Mock

function fakeCustomer(overrides: Partial<{ failed_attempts: number; locked_until: Date | null }> = {}) {
    const customer = {
        id: 42,
        name: "Cliente Uno",
        companyName: "Acme SA",
        email: "cliente@acme.com",
        password: "hashed-password",
        failed_attempts: overrides.failed_attempts ?? 0,
        locked_until: overrides.locked_until ?? null,
        update: jest.fn(async (values: { failed_attempts: number; locked_until: Date | null }) => {
            customer.failed_attempts = values.failed_attempts
            customer.locked_until = values.locked_until
        }),
    }
    return customer
}

const validInput = { email: "cliente@acme.com", password: "correct-password" }

describe("customerLoginService.login", () => {
    it("con credenciales correctas devuelve un JWT type=customer (nunca 'staff')", async () => {
        const customer = fakeCustomer()
        mockFindOne.mockResolvedValue(customer)
        mockCompare.mockResolvedValue(true)

        const result = await customerLoginService.login(validInput)

        expect(result.customer).toEqual({ id: 42, name: "Cliente Uno", companyName: "Acme SA", email: "cliente@acme.com" })
        const payload = jwt.verify(result.token, "test-secret") as jwt.JwtPayload
        expect(payload).toMatchObject({ sub: 42, type: "customer" })
        // El payload de cliente no debe traer roleId/permissions -- si algún día se le
        // agregan por error, este token dejaría de ser distinguible de uno de staff.
        expect(payload).not.toHaveProperty("permissions")
        expect(payload).not.toHaveProperty("roleId")
    })

    it("rechaza con 401 si el email no existe", async () => {
        mockFindOne.mockResolvedValue(null)

        await expect(customerLoginService.login(validInput)).rejects.toMatchObject({ statusCode: 401, key: "errors.invalid_credentials" })
    })

    it("rechaza con 401 y registra el intento fallido si la contraseña es incorrecta", async () => {
        const customer = fakeCustomer()
        mockFindOne.mockResolvedValue(customer)
        mockCompare.mockResolvedValue(false)

        await expect(customerLoginService.login(validInput)).rejects.toMatchObject({ statusCode: 401 })
        expect(customer.failed_attempts).toBe(1)
    })

    it("rechaza con 423 si la cuenta está bloqueada, sin comparar la contraseña", async () => {
        const customer = fakeCustomer({ locked_until: new Date(Date.now() + 60_000) })
        mockFindOne.mockResolvedValue(customer)

        await expect(customerLoginService.login(validInput)).rejects.toMatchObject({ statusCode: 423, key: "errors.account_locked" })
        expect(mockCompare).not.toHaveBeenCalled()
    })

    it("bloquea la cuenta del cliente tras 5 intentos fallidos, igual que a un usuario staff", async () => {
        const customer = fakeCustomer({ failed_attempts: 4 })
        mockFindOne.mockResolvedValue(customer)
        mockCompare.mockResolvedValue(false)

        await expect(customerLoginService.login(validInput)).rejects.toMatchObject({ statusCode: 401 })

        expect(customer.locked_until).not.toBeNull()
    })
})
