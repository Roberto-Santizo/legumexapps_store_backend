// Mismo criterio que login.service.test.ts: no se mockea accountLockout.service, corre
// integrado con la lógica real de bloqueo (que ya tiene su propia suite exhaustiva aparte).
jest.mock("../models/Salesperson.model", () => ({
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
import Salesperson from "../models/Salesperson.model"
import { salespersonLoginService } from "./salespersonLogin.service"

const mockFindOne = Salesperson.findOne as unknown as jest.Mock
const mockCompare = bcrypt.compare as unknown as jest.Mock

function fakeSalesperson(overrides: Partial<{ failed_attempts: number; locked_until: Date | null }> = {}) {
    const salesperson = {
        id: 42,
        name: "Representante Uno",
        companyName: "Acme SA",
        email: "representante@acme.com",
        password: "hashed-password",
        failed_attempts: overrides.failed_attempts ?? 0,
        locked_until: overrides.locked_until ?? null,
        update: jest.fn(async (values: { failed_attempts: number; locked_until: Date | null }) => {
            salesperson.failed_attempts = values.failed_attempts
            salesperson.locked_until = values.locked_until
        }),
    }
    return salesperson
}

const validInput = { email: "representante@acme.com", password: "correct-password" }

describe("salespersonLoginService.login", () => {
    it("con credenciales correctas devuelve un JWT type=customer (nunca 'staff') -- el literal del claim se conserva a propósito (rename 2026-09-16), ver comentario en salespersonLogin.service.ts", async () => {
        const salesperson = fakeSalesperson()
        mockFindOne.mockResolvedValue(salesperson)
        mockCompare.mockResolvedValue(true)

        const result = await salespersonLoginService.login(validInput)

        expect(result.salesperson).toEqual({ id: 42, name: "Representante Uno", companyName: "Acme SA", email: "representante@acme.com" })
        const payload = jwt.verify(result.token, "test-secret") as jwt.JwtPayload
        expect(payload).toMatchObject({ sub: 42, type: "customer" })
        // El payload de representante no debe traer roleId/permissions -- si algún día se le
        // agregan por error, este token dejaría de ser distinguible de uno de staff.
        expect(payload).not.toHaveProperty("permissions")
        expect(payload).not.toHaveProperty("roleId")
    })

    it("rechaza con 401 si el email no existe", async () => {
        mockFindOne.mockResolvedValue(null)

        await expect(salespersonLoginService.login(validInput)).rejects.toMatchObject({ statusCode: 401, key: "errors.invalid_credentials" })
    })

    it("rechaza con 401 y registra el intento fallido si la contraseña es incorrecta", async () => {
        const salesperson = fakeSalesperson()
        mockFindOne.mockResolvedValue(salesperson)
        mockCompare.mockResolvedValue(false)

        await expect(salespersonLoginService.login(validInput)).rejects.toMatchObject({ statusCode: 401 })
        expect(salesperson.failed_attempts).toBe(1)
    })

    it("rechaza con 423 si la cuenta está bloqueada, sin comparar la contraseña", async () => {
        const salesperson = fakeSalesperson({ locked_until: new Date(Date.now() + 60_000) })
        mockFindOne.mockResolvedValue(salesperson)

        await expect(salespersonLoginService.login(validInput)).rejects.toMatchObject({ statusCode: 423, key: "errors.account_locked" })
        expect(mockCompare).not.toHaveBeenCalled()
    })

    it("bloquea la cuenta del representante tras 5 intentos fallidos, igual que a un usuario staff", async () => {
        const salesperson = fakeSalesperson({ failed_attempts: 4 })
        mockFindOne.mockResolvedValue(salesperson)
        mockCompare.mockResolvedValue(false)

        await expect(salespersonLoginService.login(validInput)).rejects.toMatchObject({ statusCode: 401 })

        expect(salesperson.locked_until).not.toBeNull()
    })
})
