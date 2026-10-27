import type { Transaction } from "sequelize"
import Unit from "../../features/unit/models/Unit.model"
import { UNIT_CATALOG } from "../../features/unit/constants/unitCatalog"

export async function seedUnits(transaction: Transaction): Promise<void> {
    await Unit.bulkCreate(UNIT_CATALOG.map(unit=>({unitCode:unit.key,displayName:unit.displayName,unitType:unit.unitType,baseFactor:unit.baseFactor,isActive:true})),{ignoreDuplicates:true,transaction})
}
