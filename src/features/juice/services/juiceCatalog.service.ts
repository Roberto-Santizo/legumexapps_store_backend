import { Attributes, CreationAttributes, ModelStatic, Op, Transaction, UniqueConstraintError, WhereOptions, col, fn, where } from "sequelize"
import { z } from "zod"
import sequelize from "../../../database/connection"
import BaseCatalogModel from "../../../shared/base-model/BaseCatalogModel"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { resolveCatalogImage } from "../../../shared/utils/catalogImage.util"
import { generateUniqueSlug } from "../../../shared/utils/slug.util"
import { toDecimal } from "../../../shared/utils/money.util"
import Client from "../../client/models/Client.model"
import Juice from "../models/Juice.model"
import JuiceRawMaterial from "../models/JuiceRawMaterial.model"
import JuicePresentation from "../models/JuicePresentation.model"
import JuiceMix from "../models/JuiceMix.model"
import JuiceSpiceMaterial from "../models/JuiceSpiceMaterial.model"
import JuiceSpice from "../models/JuiceSpice.model"
import * as schemas from "../schemas/juice.schema"
import { juiceDto } from "./juiceDto"

type Values = Record<string, unknown>

// A local factory for the identical CRUD contract; all domain validation stays below.
function catalogService<M extends BaseCatalogModel>(options: {
    model: ModelStatic<M>
    resource: string
    createSchema: z.ZodType<Values>
    updateSchema: z.ZodType<Values>
    hasCode?: boolean
    scopedByJuice?: boolean
    serializeMixWrites?: boolean
    uniqueFields?: string[]
    prepare?: (values: Values, row: Values | undefined, transaction?: Transaction) => Promise<Values>
}) {
    const { model, resource } = options
    const txOptions = (transaction?: Transaction) => transaction ? { transaction } : {}

    async function find(id: number, active: boolean, transaction?: Transaction): Promise<M> {
        const row = await model.findOne({ where: { id, ...(active ? { isActive: true } : {}) } as WhereOptions<Attributes<M>>, ...txOptions(transaction) })
        if (!row) throw new NotFoundError(resource, id)
        return row
    }

    async function unique(values: Values, id?: number, transaction?: Transaction): Promise<void> {
        const condition = options.hasCode
            ? { [Op.and]: [where(fn("lower", col("code")), String(values.code).toLowerCase())] }
            : options.uniqueFields ? Object.fromEntries(options.uniqueFields.map(key => [key, values[key]])) : null
        if (!condition) return
        const duplicate = await model.findOne({
            where: { ...condition, ...(id ? { id: { [Op.ne]: id } } : {}) } as WhereOptions<Attributes<M>>,
            ...txOptions(transaction),
        })
        if (duplicate) throw new AppError(409, "errors.juice_duplicate")
    }

    async function write<T>(operation: (transaction?: Transaction) => Promise<T>): Promise<T> {
        try {
            return options.serializeMixWrites ? await sequelize.transaction(transaction => operation(transaction)) : await operation()
        } catch (error) {
            if (error instanceof UniqueConstraintError) throw new AppError(409, "errors.juice_duplicate")
            throw error
        }
    }

    return {
        async list(juiceId?: number) {
            const rows = await model.findAll({
                where: (options.scopedByJuice && juiceId !== undefined ? { juiceId } : {}) as WhereOptions<Attributes<M>>,
                order: [["isActive", "DESC"], ["id", "DESC"]],
            })
            return rows.map(juiceDto)
        },
        async get(id: number) { return juiceDto(await find(id, true)) },
        async create(body: unknown) {
            const input = options.createSchema.parse(body)
            return write(async transaction => {
                await unique(input, undefined, transaction)
                const prepared = options.prepare ? await options.prepare(input, undefined, transaction) : input
                return juiceDto(await model.create(prepared as CreationAttributes<M>, txOptions(transaction)))
            })
        },
        async update(id: number, body: unknown) {
            const input = options.updateSchema.parse(body)
            return write(async transaction => {
                const row = await find(id, true, transaction)
                const stored = row.toJSON() as Values
                await unique({ ...stored, ...input }, id, transaction)
                const prepared = options.prepare ? await options.prepare(input, stored, transaction) : input
                return juiceDto(await row.update(prepared, txOptions(transaction)))
            })
        },
        async setStatus(id: number, isActive: boolean) {
            return write(async transaction => {
                const row = await find(id, false, transaction)
                if (isActive && options.prepare) {
                    const stored = row.toJSON() as Values
                    await options.prepare(stored, stored, transaction)
                }
                return juiceDto(await row.update({ isActive }, txOptions(transaction)))
            })
        },
    }
}

export async function requireJuiceClient(clientId: number): Promise<void> {
    const client = await Client.findOne({ where: { id: clientId, isActive: true } })
    if (!client) throw new NotFoundError("Client", clientId)
}

async function requireJuice(juiceId: number, transaction?: Transaction): Promise<Juice> {
    const juice = await Juice.findOne({
        where: { id: juiceId, isActive: true },
        ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}),
    })
    if (!juice) throw new NotFoundError("Juice", juiceId)
    return juice
}

export const juiceRawMaterialService = catalogService({
    model: JuiceRawMaterial, resource: "JuiceRawMaterial", hasCode: true,
    createSchema: schemas.createJuiceRawMaterialSchema, updateSchema: schemas.updateJuiceRawMaterialSchema,
    async prepare(input) {
        // The workbook's cost/liter formula is yield pounds per liter × source unit cost.
        // purchaseUnit is retained as source metadata; no implicit unit conversion is added.
        const cost = toDecimal(Number(input.yieldPoundsPerLiter)).times(Number(input.costPerUnit))
        if (cost.greaterThan("9999999999.9999")) throw new AppError(422, "errors.juice_cost_out_of_range")
        return { ...input, costPerLiter: cost.toDecimalPlaces(12).toNumber() }
    },
})

export const juiceService = catalogService({
    model: Juice, resource: "Juice", hasCode: true,
    createSchema: schemas.createJuiceSchema, updateSchema: schemas.updateJuiceSchema,
    async prepare(input, stored) {
        await requireJuiceClient(Number(input.clientId))
        const { image, ...rest } = input
        const imageUrl = await resolveCatalogImage(stored?.imageUrl as string | null | undefined, image as string | null | undefined, "juices")
        const urlSlug = stored?.urlSlug ?? await generateUniqueSlug(String(input.displayName), async candidate =>
            !!(await Juice.findOne({ where: { urlSlug: candidate } })))
        return { ...rest, urlSlug, ...(imageUrl !== undefined ? { imageUrl } : stored ? {} : { imageUrl: null }) }
    },
})

export const juicePresentationService = catalogService({
    model: JuicePresentation, resource: "JuicePresentation", scopedByJuice: true,
    uniqueFields: ["juiceId", "displayLabel"],
    createSchema: schemas.createJuicePresentationSchema, updateSchema: schemas.updateJuicePresentationSchema,
    async prepare(input, stored) {
        await requireJuice(Number(stored?.juiceId ?? input.juiceId))
        return input
    },
})

export const juiceMixService = catalogService({
    model: JuiceMix, resource: "JuiceMix", scopedByJuice: true, serializeMixWrites: true,
    uniqueFields: ["juiceId", "rawMaterialId"],
    createSchema: schemas.createJuiceMixSchema, updateSchema: schemas.updateJuiceMixSchema,
    async prepare(input, stored, transaction) {
        const juiceId = Number(stored?.juiceId ?? input.juiceId)
        // Lock the parent to serialize all mix creates, edits and reactivations for this juice.
        await requireJuice(juiceId, transaction)
        const rawMaterialId = Number(stored?.rawMaterialId ?? input.rawMaterialId)
        if (!await JuiceRawMaterial.findOne({ where: { id: rawMaterialId, isActive: true }, transaction })) {
            throw new NotFoundError("JuiceRawMaterial", rawMaterialId)
        }
        const others = await JuiceMix.findAll({
            where: { juiceId, isActive: true, ...(stored?.id ? { id: { [Op.ne]: Number(stored.id) } } : {}) },
            transaction,
        })
        const total = others.reduce((sum, row) => sum.plus(row.percentage), toDecimal(Number(input.percentage)))
        if (total.greaterThan(100)) throw new AppError(422, "errors.juice_mix_ceiling", { total: total.toString() })
        // Under 100% is allowed while admins build the recipe; the calculation rejects incomplete mixes.
        return input
    },
})

export const juiceSpiceMaterialService = catalogService({
    model: JuiceSpiceMaterial, resource: "JuiceSpiceMaterial", hasCode: true,
    createSchema: schemas.createJuiceSpiceMaterialSchema, updateSchema: schemas.updateJuiceSpiceMaterialSchema,
})

export const juiceSpiceService = catalogService({
    model: JuiceSpice, resource: "JuiceSpice", scopedByJuice: true,
    uniqueFields: ["juiceId", "spiceMaterialId"],
    createSchema: schemas.createJuiceSpiceSchema, updateSchema: schemas.updateJuiceSpiceSchema,
    async prepare(input, stored) {
        await requireJuice(Number(stored?.juiceId ?? input.juiceId))
        const spiceMaterialId = Number(stored?.spiceMaterialId ?? input.spiceMaterialId)
        if (!await JuiceSpiceMaterial.findOne({ where: { id: spiceMaterialId, isActive: true } })) {
            throw new NotFoundError("JuiceSpiceMaterial", spiceMaterialId)
        }
        return input
    },
})
