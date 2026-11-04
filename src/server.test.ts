import request from "supertest"

jest.mock("./database/connection", () => ({ __esModule: true, default: { query: jest.fn() } }))
jest.mock("./routes", () => ({ __esModule: true, default: require("express").Router() }))
jest.mock("./features/accessControl/login/services/accountStatus.service", () => ({ accountStatusService: {} }))

import server from "./server"

test.each(["es", "en"])("returns translated JSON for malformed request bodies (%s) without logging their contents", async language => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined)
    try {
        const response = await request(server).post("/api/probe").set("Accept-Language", language)
            .set("Content-Type", "application/json").send('{"private":"synthetic-secret",')
        expect(response.status).toBe(400)
        expect(response.type).toBe("application/json")
        expect(response.body.message).toBe(language === "es" ? "El cuerpo de la solicitud debe contener JSON válido." : "The request body must contain valid JSON.")
        expect(JSON.stringify(response.body)).not.toMatch(/synthetic-secret|SyntaxError|stack/)
        expect(logged).not.toHaveBeenCalled()
    } finally { logged.mockRestore() }
})

test("returns 413 JSON for a body exceeding the production parser limit", async () => {
    const response = await request(server).post("/api/probe").set("Accept-Language", "en")
        .send({ value: "x".repeat(20 * 1024 * 1024) })
    expect(response.status).toBe(413)
    expect(response.type).toBe("application/json")
    expect(response.body).toEqual({ message: "The request body exceeds the allowed size." })
})
