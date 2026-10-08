import { OptimisticLockError, UniqueConstraintError } from "sequelize"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import JuiceCostConstants from "../models/JuiceCostConstants.model"
import JuiceClientConstantOverride from "../models/JuiceClientConstantOverride.model"
import { JUICE_CONSTANT_FIELDS, JuiceConstantField, JuiceConstantsValues } from "../constants/juice.constant"
import {
    createJuiceCostConstantsSchema,
    updateJuiceCostConstantsSchema,
    createJuiceClientConstantOverrideSchema,
    updateJuiceClientConstantOverrideSchema,
} from "../schemas/juiceConfig.schema"
import { requireJuiceClient } from "./juiceCatalog.service"
import { juiceDto } from "./juiceDto"

async function globalRow(): Promise<JuiceCostConstants> {
    const row = await JuiceCostConstants.findOne({ where: { singletonKey: "global" } })
    if (!row) throw new AppError(422, "errors.juice_config_required")
    return row
}

async function overrideRow(clientId: number): Promise<JuiceClientConstantOverride> {
    const row = await JuiceClientConstantOverride.findOne({ where: { clientId } })
    if (!row) throw new NotFoundError("JuiceClientConstantOverride", clientId)
    return row
}

export const juiceConfigService = {
    async getGlobal() { return juiceDto(await globalRow()) },
    async createGlobal(body: unknown) {
        const input = createJuiceCostConstantsSchema.parse(body)
        if (await JuiceCostConstants.findOne({ where: { singletonKey: "global" } })) {
            throw new AppError(409, "errors.juice_config_already_exists")
        }
        try {
            return juiceDto(await JuiceCostConstants.create({ ...input, singletonKey: "global" }))
        } catch (error) {
            if (error instanceof UniqueConstraintError) throw new AppError(409, "errors.juice_config_already_exists")
            throw error
        }
    },
    async updateGlobal(body: unknown) {
        const input = updateJuiceCostConstantsSchema.parse(body)
        const row = await globalRow()
        try {
            // Sequelize optimistic locking increments revision and rejects a stale row.
            return juiceDto(await row.update(input))
        } catch (error) {
            if (error instanceof OptimisticLockError) throw new AppError(409, "errors.juice_config_conflict")
            throw error
        }
    },
    async listOverrides() {
        return (await JuiceClientConstantOverride.findAll({ order: [["isActive", "DESC"], ["clientId", "ASC"]] })).map(juiceDto)
    },
    async getOverride(clientId: number) { return juiceDto(await overrideRow(clientId)) },
    async createOverride(body: unknown) {
        const input = createJuiceClientConstantOverrideSchema.parse(body)
        await requireJuiceClient(input.clientId)
        if (await JuiceClientConstantOverride.findOne({ where: { clientId: input.clientId } })) {
            throw new AppError(409, "errors.juice_duplicate")
        }
        try {
            return juiceDto(await JuiceClientConstantOverride.create(input))
        } catch (error) {
            if (error instanceof UniqueConstraintError) throw new AppError(409, "errors.juice_duplicate")
            throw error
        }
    },
    async updateOverride(clientId: number, body: unknown) {
        const input = updateJuiceClientConstantOverrideSchema.parse(body)
        await requireJuiceClient(clientId)
        const row = await overrideRow(clientId)
        return juiceDto(await row.update(input))
    },
    async setOverrideStatus(clientId: number, isActive: boolean) {
        const row = await overrideRow(clientId)
        if (isActive) await requireJuiceClient(clientId)
        return juiceDto(await row.update({ isActive }))
    },
    async resolveConstants(clientId: number): Promise<{
        values: JuiceConstantsValues
        sources: Record<JuiceConstantField, "global" | "client">
        globalRevision: number
    }> {
        await requireJuiceClient(clientId)
        const global = await globalRow()
        const override = await JuiceClientConstantOverride.findOne({ where: { clientId, isActive: true } })
        const values = {} as JuiceConstantsValues
        const sources = {} as Record<JuiceConstantField, "global" | "client">
        for (const key of JUICE_CONSTANT_FIELDS) {
            const value = override?.[key]
            const inherited = value === null || value === undefined
            values[key] = Number(inherited ? global[key] : value)
            sources[key] = inherited ? "global" : "client"
        }
        return { values, sources, globalRevision: global.revision }
    },
}
