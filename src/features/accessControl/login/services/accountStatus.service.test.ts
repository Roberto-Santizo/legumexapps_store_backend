jest.mock("../../user/models/User.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))
jest.mock("../../../salesperson/models/Salesperson.model", () => ({ __esModule: true, default: { findOne: jest.fn() } }))

import User from "../../user/models/User.model"
import Salesperson from "../../../salesperson/models/Salesperson.model"
import { accountStatusService } from "./accountStatus.service"

test.each([
    ["staff", User, accountStatusService.isStaffActive],
    ["representative", Salesperson, accountStatusService.isSalespersonActive],
] as const)("checks the current active %s without loading passwords or caching results", async (_kind, model, read) => {
    const find = jest.mocked(model.findOne)
    find.mockResolvedValueOnce({ id: 7 } as User & Salesperson).mockResolvedValueOnce(null)
    expect(await read(7)).toBe(true)
    expect(await read(7)).toBe(false)
    expect(find).toHaveBeenCalledWith({ where: { id: 7, isActive: true }, attributes: ["id"] })
})
