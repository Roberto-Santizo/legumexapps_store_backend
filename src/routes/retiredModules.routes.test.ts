import request from "supertest"
import router from "./index"
import { buildTestApp } from "../shared/test-utils/testApp"

const app = buildTestApp("/api", router)

test("retired prospect and landing image endpoints are no longer registered", async () => {
    expect((await request(app).post("/api/leads").send({ fullName: "Synthetic", companyName: "Synthetic", email: "test@example.invalid", phone: "000" })).status).toBe(404)
    for (const route of ["/api/leads", "/api/admin/leads", "/api/admin/leads/1"]) expect((await request(app).get(route)).status).toBe(404)
    expect((await request(app).patch("/api/admin/leads/1").send({ status: "contacted" })).status).toBe(404)
    for (const route of ["/api/site-images", "/api/admin/site-images"]) expect((await request(app).get(route)).status).toBe(404)
    // Existing quotation access remains registered and protected.
    expect((await request(app).get("/api/quotes/clients")).status).toBe(401)
})
