jest.mock("../models/Quote.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../../customQuote/models/CustomQuote.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))
jest.mock("../../salesperson/models/Salesperson.model", () => ({ __esModule: true, default: {} }))
jest.mock("../../accessControl/user/models/User.model", () => ({ __esModule: true, default: {} }))

import Quote from "../models/Quote.model"
import CustomQuote from "../../customQuote/models/CustomQuote.model"
import { groupProductionOrders, listProductionOrders } from "./productionOrder.service"

const order = { id: "5e226064-21be-4a9a-a5e5-f312391e363a", clientName: "Customer A" }
const line = (id: number, salespersonId = 1, identity = order, createdAt = "2026-10-08T12:00:00Z") => ({ id, salespersonId, createdAt, breakdown: { order: identity }, productDisplayName: `Product ${id}` })

test("groups fixed and customizable lines in one order without mixing representatives or customers", () => {
    const result = groupProductionOrders([
        { kind: "fixed", quote: line(1) }, { kind: "customizable", quote: line(2) },
        { kind: "fixed", quote: line(3, 2) }, { kind: "fixed", quote: line(4, 1, { ...order, clientName: "Customer B" }) },
    ])
    expect(result).toHaveLength(3)
    const mixed = result.find(group => group.salesperson.id === 1 && group.clientName === "Customer A")!
    expect(mixed.lines.map(row => row.quoteKind)).toEqual(["fixed", "customizable"])
})

test("admin-saved lines group under the staff user and never merge with a representative of the same id", () => {
    const admin = (id: number) => ({ ...line(id), salespersonId: null, createdByUserId: 1, quotingUser: { id: 1, name: "Ana Admin" } })
    const result = groupProductionOrders([{ kind: "fixed", quote: admin(1) }, { kind: "fixed", quote: admin(2) }, { kind: "fixed", quote: line(3) }])
    expect(result).toHaveLength(2)
    expect(result.find(group => group.salesperson.isAdmin)).toMatchObject({ salesperson: { id: 1, name: "Ana Admin", isAdmin: true }, clientName: "Customer A" })
    expect(result.find(group => group.salesperson.isAdmin)!.lines).toHaveLength(2)
})

test("legacy records without order identity remain separate, even with equal row IDs", () => {
    const quote = { id: 1, salespersonId: 1, createdAt: "2026-10-08T12:00:00Z", breakdown: {} }
    expect(groupProductionOrders([{ kind: "fixed", quote }, { kind: "customizable", quote }]).map(row => row.id)).toEqual(["fixed-1", "customizable-1"])
})

test("equal customer names and order UUIDs do not merge different catalog customer identities", () => {
    const first = { ...line(1), breakdown: { order: { ...order, clientId: 11 } } }
    const second = { ...line(2), breakdown: { order: { ...order, clientId: 12 } } }
    const prospect = { ...line(3), breakdown: { order: { ...order, clientId: null } } }
    expect(groupProductionOrders([{ kind: "fixed", quote: first }, { kind: "fixed", quote: second }, { kind: "customizable", quote: prospect }])).toHaveLength(3)
})

test("date filter selects a complete mixed order and uses Guatemala dates", async () => {
    const fixed = line(1, 1, order, "2026-10-09T02:00:00Z") // Guatemala: Oct 8
    const custom = line(2, 1, order, "2026-10-09T13:00:00Z") // Guatemala: Oct 9
    ;(Quote.findAll as jest.Mock).mockResolvedValue([{ toJSON: () => fixed }])
    ;(CustomQuote.findAll as jest.Mock).mockResolvedValue([{ toJSON: () => custom }])
    const result = await listProductionOrders({ startDate: "2026-10-08", endDate: "2026-10-08" })
    expect(result).toHaveLength(1)
    expect(result[0].lines).toHaveLength(2)
    expect(await listProductionOrders({ startDate: "2026-10-10", endDate: "2026-10-10" })).toHaveLength(0)
})
