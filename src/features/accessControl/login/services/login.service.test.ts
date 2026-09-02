// No se mockea accountLockout.service a propósito: este test cubre login.service +
// accountLockout integrados, tal como corren en producción. La aritmética del lockout
// en sí (contador, 15 min, reset) ya tiene su propia cobertura exhaustiva en
// shared/services/accountLockout.service.test.ts -- acá lo que importa es que login.service
// llame a las funciones correctas en el orden correcto.
jest.mock("../../user/models/user.model", () => ({
    __esModule: true,
    default: { findOne: jest.fn() }
}))
jest.mock("bcryptjs", () => ({
    __esModule: true,
    default: { compare: jest.fn() }
}))
jest.mock("../../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))

import jwt from "jsonwebtoken"
import bcrypt from "bcryptjs"
import User from "../../user/models/user.model"
import { authService } from "./login.service"
import { AppError } from "../../../../shared/errors/AppError"

const mockFindOne = User.findOne as unknown as jest.Mock
const mockCompare = bcrypt.compare as unknown as jest.Mock

function fakeUser(overrides: Partial<{ failed_attempts: number; locked_until: Date | null; password: string }> = {}) {
    const user = {
        id: 3,
        name: "Ana Admin",
        username: "ana",
        password: overrides.password ?? "hashed-password",
        role_id: 2,
        failed_attempts: overrides.failed_attempts ?? 0,
        locked_until: overrides.locked_until ?? null,
        role: { name: "Admin", permissions: [{ name: "products:edit" }, { name: "quotes:view" }] },
        update: jest.fn(async (values: { failed_attempts: number; locked_until: Date | null }) => {
            user.failed_attempts = values.failed_attempts
            user.locked_until = values.locked_until
        }),
    }
    return user
}

const validInput = { username: "ana", password: "correct-password" }

describe("authService.login (staff)", () => {
    it("con credenciales correctas devuelve un JWT type=staff con los permisos del rol", async () => {
        const user = fakeUser()
        mockFindOne.mockResolvedValue(user)
        mockCompare.mockResolvedValue(true)

        const result = await authService.login(validInput)

        expect(result.user).toEqual({ id: 3, name: "Ana Admin", username: "ana", role: "Admin", permissions: ["products:edit", "quotes:view"] })
        const payload = jwt.verify(result.token, "test-secret") as jwt.JwtPayload
        expect(payload).toMatchObject({ sub: 3, type: "staff", roleId: 2, roleName: "Admin", permissions: ["products:edit", "quotes:view"] })
    })

    it("limpia el contador de intentos fallidos tras un login exitoso", async () => {
        const user = fakeUser({ failed_attempts: 3 })
        mockFindOne.mockResolvedValue(user)
        mockCompare.mockResolvedValue(true)

        await authService.login(validInput)

        expect(user.failed_attempts).toBe(0)
    })

    it("rechaza con 401 si el usuario no existe, sin distinguir el mensaje de una contraseña incorrecta", async () => {
        mockFindOne.mockResolvedValue(null)

        await expect(authService.login(validInput)).rejects.toMatchObject({ statusCode: 401, key: "errors.invalid_credentials" })
        expect(mockCompare).not.toHaveBeenCalled()
    })

    it("rechaza con 401 si la contraseña es incorrecta y registra el intento fallido", async () => {
        const user = fakeUser({ failed_attempts: 0 })
        mockFindOne.mockResolvedValue(user)
        mockCompare.mockResolvedValue(false)

        await expect(authService.login(validInput)).rejects.toMatchObject({ statusCode: 401, key: "errors.invalid_credentials" })
        expect(user.failed_attempts).toBe(1)
    })

    it("bloquea la cuenta tras 5 contraseñas incorrectas seguidas", async () => {
        const user = fakeUser({ failed_attempts: 4 })
        mockFindOne.mockResolvedValue(user)
        mockCompare.mockResolvedValue(false)

        await expect(authService.login(validInput)).rejects.toMatchObject({ key: "errors.invalid_credentials" })

        expect(user.locked_until).not.toBeNull()
        expect(user.failed_attempts).toBe(0) // el contador se resetea al quedar bloqueada
    })

    it("rechaza con 423 si la cuenta ya está bloqueada, SIN intentar comparar la contraseña", async () => {
        const user = fakeUser({ locked_until: new Date(Date.now() + 60_000) })
        mockFindOne.mockResolvedValue(user)

        await expect(authService.login(validInput)).rejects.toMatchObject({ statusCode: 423, key: "errors.account_locked" })
        // No se filtra si la contraseña era correcta o no mientras está bloqueada.
        expect(mockCompare).not.toHaveBeenCalled()
    })

    it("permite login normal si el bloqueo anterior ya expiró", async () => {
        const user = fakeUser({ locked_until: new Date(Date.now() - 60_000), failed_attempts: 0 })
        mockFindOne.mockResolvedValue(user)
        mockCompare.mockResolvedValue(true)

        await expect(authService.login(validInput)).resolves.toBeDefined()
    })

    it("propaga instancias de AppError, no errores genéricos, para que errorHandler las mapee bien", async () => {
        mockFindOne.mockResolvedValue(null)

        await expect(authService.login(validInput)).rejects.toBeInstanceOf(AppError)
    })
})
