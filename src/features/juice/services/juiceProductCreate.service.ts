import sequelize from "../../../database/connection"
import { UniqueConstraintError } from "sequelize"
import { AppError } from "../../../shared/errors/AppError"
import { createLinkedJuiceSchema } from "../schemas/juice.schema"
import { juiceService } from "./juiceCatalog.service"
import { linkJuiceProduct } from "./juiceProductLink.service"

export async function createLinkedJuice(body: unknown) {
    const { subCategoryId, ...input } = createLinkedJuiceSchema.parse(body)
    try {
        return await sequelize.transaction(async transaction => {
            const juice = await juiceService.create(input, transaction)
            if (!juice || typeof juice !== "object" || !("id" in juice) || typeof juice.id !== "number") throw new AppError(500, "errors.internal")
            const link = await linkJuiceProduct(Number(juice.id), subCategoryId, transaction)
            return { ...juice, productId: link.productId }
        })
    } catch (error) {
        if (error instanceof UniqueConstraintError) throw new AppError(409, "errors.juice_duplicate")
        throw error
    }
}
