jest.mock("../services/login.service", () => ({
    authService: { login: jest.fn() }
}))

import request from "supertest"
import { buildTestApp } from "../../../../shared/test-utils/testApp"
import loginRouter from "./login.routes"
import { authService } from "../services/login.service"
import { AppError } from "../../../../shared/errors/AppError"

const app = buildTestApp("/api/login", loginRouter)

describe("loginRouter (HTTP)", () => {
    it("400 si falta username o password (nunca llega al service)", async () => {
        const res = await request(app).post("/api/login").send({ username: "ana" })

        expect(res.status).toBe(400)
        expect(authService.login).not.toHaveBeenCalled()
    })

    it("400 si username es solo espacios en blanco", async () => {
        const res = await request(app).post("/api/login").send({ username: "   ", password: "x" })
        expect(res.status).toBe(400)
    })

    it("200 con token y datos del usuario en credenciales correctas", async () => {
        (authService.login as jest.Mock).mockResolvedValue({ token: "a.b.c", user: { id: 1, username: "ana" } })

        const res = await request(app).post("/api/login").send({ username: "ana", password: "correcta" })

        expect(res.status).toBe(200)
        expect(res.body).toEqual({ data: { token: "a.b.c", user: { id: 1, username: "ana" } } })
    })

    it("401 en credenciales incorrectas, con el mensaje traducido", async () => {
        (authService.login as jest.Mock).mockRejectedValue(new AppError(401, "errors.invalid_credentials"))

        const res = await request(app).post("/api/login").send({ username: "ana", password: "mala" })

        expect(res.status).toBe(401)
        expect(res.body.message).toBe("Usuario o contraseña inválidos")
    })

    it("423 con la cuenta bloqueada, con el mensaje traducido (para que el cliente lo muestre tal cual)", async () => {
        (authService.login as jest.Mock).mockRejectedValue(new AppError(423, "errors.account_locked"))

        const res = await request(app).post("/api/login").send({ username: "ana", password: "mala" })

        expect(res.status).toBe(423)
        expect(res.body.message).toBe("Cuenta bloqueada por demasiados intentos fallidos. Intenta más tarde")
    })
})
