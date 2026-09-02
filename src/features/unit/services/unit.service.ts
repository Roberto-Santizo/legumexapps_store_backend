import { Op, WhereOptions } from "sequelize";
import Unit from "../models/Unit.model";
import { AppError, NotFoundError } from "../../../shared/errors/AppError";
import { CreateUnitInput, UpdateUnitInput } from "../schemas/unit.schema";
import { generateUniqueSlug } from "../../../shared/utils/slug.util";
import { getUnitCatalogEntry } from "../constants/unitCatalog";
import { paginate, PaginatedResult, PaginationParams } from "../../../shared/utils/pagination.util";

async function listUnits(pagination?: PaginationParams, search?: string): Promise<PaginatedResult<Unit>> {
    const where: WhereOptions = { isActive: true, ...(search ? { displayName: { [Op.iLike]: `%${search}%` } } : {}) }
    return paginate(Unit, { where, order: [["displayName", "DESC"]] }, pagination);
}

async function getUnitById(id: number): Promise<Unit> {
    const unit = await Unit.findOne({ where: { id, isActive: true } });
    if (!unit) throw new NotFoundError("Unit", id);
    return unit;
}


function resolveCatalogEntry(unitKey: string) {
    const catalogEntry = getUnitCatalogEntry(unitKey);
    if (!catalogEntry) throw new AppError(422, "errors.invalid_unit_key");
    return catalogEntry;
}

async function createUnit(input: CreateUnitInput): Promise<Unit> {
    const catalogEntry = resolveCatalogEntry(input.unitKey);
    const unitCode = await generateUniqueSlug(catalogEntry.displayName, async (candidate) => {
        const existing = await Unit.findOne({ where: { unitCode: candidate } });
        return !!existing;
    });
    return Unit.create({
        displayName: catalogEntry.displayName,
        unitType: catalogEntry.unitType,
        baseFactor: catalogEntry.baseFactor,
        unitCode,
    });
}

async function updateUnit(id: number, input: UpdateUnitInput): Promise<Unit> {
    const unit = await getUnitById(id);
    const catalogEntry = resolveCatalogEntry(input.unitKey);
    return unit.update({
        displayName: catalogEntry.displayName,
        unitType: catalogEntry.unitType,
        baseFactor: catalogEntry.baseFactor,
    });
}
async function deleteUnit(id: number): Promise<void> {
    const unit = await getUnitById(id);
    await unit.update({ isActive: false });
}

export const unitService = {
    listUnits,
    getUnitById,
    createUnit,
    updateUnit,
    deleteUnit,
}
