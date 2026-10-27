jest.mock("../models/Salesperson.model", () => ({ __esModule: true, default: { findOne: jest.fn(), sequelize: { transaction: jest.fn() } } }))
jest.mock("../../client/models/Client.model", () => ({ __esModule: true, default: { findAll: jest.fn(), findByPk: jest.fn() } }))
jest.mock("../models/RepresentativeClient.model", () => ({ __esModule: true, default: { findAll: jest.fn(), bulkCreate: jest.fn(), destroy: jest.fn() } }))

import Salesperson from "../models/Salesperson.model"
import Client from "../../client/models/Client.model"
import RepresentativeClient from "../models/RepresentativeClient.model"
import { representativeClientService as service } from "./representativeClient.service"

const transaction = { LOCK: { UPDATE: "UPDATE", SHARE: "SHARE" } }
beforeEach(() => {
    jest.resetAllMocks()
    ;(Salesperson.sequelize!.transaction as jest.Mock).mockImplementation(work => work(transaction))
    ;(Salesperson.findOne as jest.Mock).mockResolvedValue({ id: 1, isActive: true })
    ;(Client.findAll as jest.Mock).mockResolvedValue([{ id: 2, isActive: true }, { id: 3, isActive: true }])
    ;(Client.findByPk as jest.Mock).mockResolvedValue({ id: 2 })
    ;(RepresentativeClient.findAll as jest.Mock).mockResolvedValue([{ client: { id: 2, name: "Client", isActive: true } }])
})

test("lists assigned clients without leaking account fields", async () => {
    expect(await service.list(1)).toEqual([{ id: 2, name: "Client", isActive: true }])
    expect(RepresentativeClient.findAll).toHaveBeenCalledWith(expect.objectContaining({ where: { representativeId: 1 } }))
})
test("missing representative fails before reading assignments", async () => {
    ;(Salesperson.findOne as jest.Mock).mockResolvedValue(null)
    await expect(service.list(55)).rejects.toMatchObject({ statusCode: 404 })
    expect(RepresentativeClient.findAll).not.toHaveBeenCalled()
})
test("batch assignment uses a single transaction, lock and additive conflict handling", async () => {
    await service.assign(1, [2, 3])
    expect(Salesperson.findOne).toHaveBeenCalledWith(expect.objectContaining({ transaction, lock: "UPDATE" }))
    expect(Client.findAll).toHaveBeenCalledWith(expect.objectContaining({ transaction, lock: "SHARE", order: [["id", "ASC"]] }))
    expect(RepresentativeClient.bulkCreate).toHaveBeenCalledWith([{ representativeId: 1, clientId: 2 }, { representativeId: 1, clientId: 3 }], { transaction, ignoreDuplicates: true })
    expect(RepresentativeClient.destroy).not.toHaveBeenCalled()
})

test("all-clients assignment resolves active clients on the server without the manual batch limit",async()=>{
    const clients=Array.from({length:125},(_,i)=>({id:i+1,isActive:true}))
    ;(Client.findAll as jest.Mock).mockResolvedValue(clients)
    await service.assignAll(1)
    expect(Client.findAll).toHaveBeenCalledWith(expect.objectContaining({where:{isActive:true},transaction,lock:'SHARE'}))
    expect((RepresentativeClient.bulkCreate as jest.Mock).mock.calls[0][0]).toHaveLength(125)
    expect(RepresentativeClient.destroy).not.toHaveBeenCalled()
})

test("assigning all with no active clients preserves existing assignments",async()=>{
    ;(Client.findAll as jest.Mock).mockResolvedValue([])
    expect(await service.assignAll(1)).toEqual([{id:2,name:'Client',isActive:true}])
    expect(RepresentativeClient.bulkCreate).not.toHaveBeenCalled()
})
test.each([
    [[], "errors.assignment_client_missing"],
    [[{ id: 2, isActive: true }, { id: 3, isActive: false }], "errors.assignment_inactive_client"],
])("invalid batch writes nothing (%j)", async (clients, key) => {
    ;(Client.findAll as jest.Mock).mockResolvedValue(clients)
    await expect(service.assign(1, [2, 3])).rejects.toMatchObject({ statusCode: 422, key })
    expect(RepresentativeClient.bulkCreate).not.toHaveBeenCalled()
})
test("inactive representative cannot receive new assignments", async () => {
    ;(Salesperson.findOne as jest.Mock).mockResolvedValue({ id: 1, isActive: false })
    await expect(service.assign(1, [2])).rejects.toMatchObject({ key: "errors.assignment_inactive_representative" })
    expect(Client.findAll).not.toHaveBeenCalled()
})
test("removal is scoped to one pair and permits inactive representatives", async () => {
    ;(Salesperson.findOne as jest.Mock).mockResolvedValue({ id: 1, isActive: false })
    await service.remove(1, 2)
    expect(RepresentativeClient.destroy).toHaveBeenCalledWith({ where: { representativeId: 1, clientId: 2 }, transaction })
})
test("nonexistent client removal fails", async () => {
    ;(Client.findByPk as jest.Mock).mockResolvedValue(null)
    await expect(service.remove(1, 22)).rejects.toMatchObject({ statusCode: 404 })
    expect(RepresentativeClient.destroy).not.toHaveBeenCalled()
})
test("authorized IDs reread active assignments on every invocation", async () => {
    expect(await service.authorizedClientIds(1)).toEqual([2])
    ;(RepresentativeClient.findAll as jest.Mock).mockResolvedValue([])
    expect(await service.authorizedClientIds(1)).toEqual([])
    expect(RepresentativeClient.findAll).toHaveBeenCalledTimes(2)
    expect(RepresentativeClient.findAll).toHaveBeenCalledWith(expect.objectContaining({ include: [expect.objectContaining({ where: { isActive: true } })] }))
})
test("inactive or nonexistent representative has no authorized clients", async () => {
    ;(Salesperson.findOne as jest.Mock).mockResolvedValue(null)
    expect(await service.authorizedClientIds(1)).toEqual([])
    expect(RepresentativeClient.findAll).not.toHaveBeenCalled()
})
