jest.mock("../../../config/env", () => ({
    env: { jwtSecret: "test-secret", jwtExpiresIn: "1h" }
}))
jest.mock("../services/siteImage.service", () => ({
    siteImageService: {
        listSiteImagesForAdmin: jest.fn(),
        upsertSiteImage: jest.fn(),
    }
}))

import request from "supertest"
import jwt from "jsonwebtoken"
import { buildTestApp } from "../../../shared/test-utils/testApp"
import adminSiteImageRouter from "./adminSiteImage.routes"
import { siteImageService } from "../services/siteImage.service"

const app = buildTestApp("/api/admin/site-images", adminSiteImageRouter)

function staffToken(permissions: string[]): string {
    return jwt.sign({ sub: 1, type: "staff", roleId: 1, roleName: "Admin", permissions }, "test-secret")
}

describe("adminSiteImageRouter (HTTP) — RBAC cableado en la ruta real", () => {
    it("GET / sin token -> 401", async () => {
        const res = await request(app).get("/api/admin/site-images")
        expect(res.status).toBe(401)
    })

    it("GET / con staff autenticado pero SIN 'siteContent:edit' -> 403", async () => {
        const res = await request(app)
            .get("/api/admin/site-images")
            .set("Authorization", `Bearer ${staffToken(["products:view"])}`)
        expect(res.status).toBe(403)
        expect(siteImageService.listSiteImagesForAdmin).not.toHaveBeenCalled()
    })

    it("GET / con 'siteContent:edit' -> 200", async () => {
        (siteImageService.listSiteImagesForAdmin as jest.Mock).mockResolvedValue([])

        const res = await request(app)
            .get("/api/admin/site-images")
            .set("Authorization", `Bearer ${staffToken(["siteContent:edit"])}`)

        expect(res.status).toBe(200)
    })

    it("PUT /:slotKey con un slotKey inválido -> 400 antes de llegar al service", async () => {
        const res = await request(app)
            .put("/api/admin/site-images/not-a-slot")
            .set("Authorization", `Bearer ${staffToken(["siteContent:edit"])}`)
            .send({ image: null })

        expect(res.status).toBe(400)
        expect(siteImageService.upsertSiteImage).not.toHaveBeenCalled()
    })

    it("PUT /:slotKey con slotKey y body válidos -> 200", async () => {
        (siteImageService.upsertSiteImage as jest.Mock).mockResolvedValue({ slotKey: "hero", imageUrl: null, altText: null })

        const res = await request(app)
            .put("/api/admin/site-images/hero")
            .set("Authorization", `Bearer ${staffToken(["siteContent:edit"])}`)
            .send({ altText: "Campo al atardecer" })

        expect(res.status).toBe(200)
        expect(siteImageService.upsertSiteImage).toHaveBeenCalledWith("hero", { altText: "Campo al atardecer" })
    })
})
