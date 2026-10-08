import { FindAttributeOptions, FindOptions, Includeable, Model, ModelStatic, Order, WhereOptions } from "sequelize"

// page/limit son opt-in (ver pagination.schema.ts): sin page, devuelve la lista completa con la misma
// forma { data } y sin meta, que es lo que consumen los selects del frontend.
export interface PaginationParams {
    page?: number
    limit?: number
}

interface PaginationMeta {
    page: number
    limit: number
    total: number
    totalPages: number
}

export interface PaginatedResult<T> {
    data: T[]
    meta?: PaginationMeta
}

const DEFAULT_LIMIT = 10

export async function paginate<M extends Model>(
    model: ModelStatic<M>,
    options: { where?: WhereOptions; order?: Order; include?: Includeable | Includeable[]; attributes?: FindAttributeOptions },
    pagination?: PaginationParams
): Promise<PaginatedResult<M>> {
    if (!pagination?.page) {
        const data = await model.findAll(options as FindOptions<M>)
        return { data }
    }

    const page = pagination.page
    const limit = pagination.limit ?? DEFAULT_LIMIT
    const offset = (page - 1) * limit

    // distinct: true evita contar de más si algún día alguna de estas listas suma un include
    // hasMany/belongsToMany (hoy ninguna lo tiene, pero así queda a prueba de eso).
    const { rows, count } = await model.findAndCountAll({
        ...options,
        limit,
        offset,
        distinct: true,
    } as FindOptions<M>)

    return {
        data: rows,
        meta: {
            page,
            limit,
            total: count,
            totalPages: Math.max(1, Math.ceil(count / limit)),
        },
    }
}
