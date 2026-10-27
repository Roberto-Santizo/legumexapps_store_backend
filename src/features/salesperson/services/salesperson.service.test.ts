jest.mock("../models/Salesperson.model", () => ({ __esModule: true, default: { create: jest.fn(), findOne: jest.fn(), sequelize: { transaction: jest.fn() } } }))
jest.mock("./representativeClient.service", () => ({ representativeClientService: { addClients: jest.fn() } }))

import Salesperson from "../models/Salesperson.model"
import { representativeClientService } from "./representativeClient.service"
import { salespersonService as service } from "./salesperson.service"
import { AppError } from "../../../shared/errors/AppError"

const transaction = { id: "tx" }
const account = { name: "Ana", email: "ana@example.com", password: "secret123" }
beforeEach(() => {
    jest.resetAllMocks()
    ;(Salesperson.sequelize!.transaction as jest.Mock).mockImplementation(work => work(transaction))
    ;(Salesperson.create as jest.Mock).mockResolvedValue({ id: 9 })
    ;(Salesperson.findOne as jest.Mock).mockResolvedValue({ id: 9, name: "Ana" })
})

test("creates the account and its clients in the same transaction, never storing the plain password", async () => {
    await service.createSalesperson({ ...account, clientIds: [2, 3] })
    const [values, options] = (Salesperson.create as jest.Mock).mock.calls[0]
    expect(options).toEqual({ transaction })
    expect(values).not.toHaveProperty("clientIds")
    expect(values.password).not.toBe(account.password)
    expect(representativeClientService.addClients).toHaveBeenCalledWith(9, [2, 3], transaction)
})
test("assign-all resolves the active clients on the server", async () => {
    await service.createSalesperson({ ...account, assignAllClients: true })
    expect(representativeClientService.addClients).toHaveBeenCalledWith(9, "all", transaction)
})
test("without clients nothing is assigned", async () => {
    await service.createSalesperson(account)
    expect(representativeClientService.addClients).not.toHaveBeenCalled()
})
test("an invalid client fails the whole creation", async () => {
    ;(representativeClientService.addClients as jest.Mock).mockRejectedValue(new AppError(422, "errors.assignment_inactive_client"))
    await expect(service.createSalesperson({ ...account, clientIds: [4] })).rejects.toMatchObject({ statusCode: 422 })
    expect(Salesperson.findOne).not.toHaveBeenCalled()
})
