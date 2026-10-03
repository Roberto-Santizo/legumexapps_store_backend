jest.mock("../../../config/env", () => ({ env: {} }))
jest.mock("../../../features/accessControl/permissions/models/permission.model", () => ({ __esModule: true, default: { bulkCreate: jest.fn(), findAll: jest.fn().mockResolvedValue([]) } }))
jest.mock("../../../features/accessControl/roles/models/role.model", () => ({ __esModule: true, default: { findOrCreate: jest.fn().mockResolvedValue([{ id: 1 }]) } }))
jest.mock("../../../features/accessControl/rolePermissions/models/rolePermission.model", () => ({ __esModule: true, default: { bulkCreate: jest.fn() } }))
jest.mock("../../../features/accessControl/user/models/user.model", () => ({ __esModule: true, default: {} }))

import Permission from "../../../features/accessControl/permissions/models/permission.model"
import { seedAccessControl } from "../../../database/seeders/accessControl.seeder"
import es from "../../../locales/es/translation.json"
import en from "../../../locales/en/translation.json"

test("RBAC seeder supplies the four juice catalog permissions and separate config permission", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined)
    try {
        await seedAccessControl()
        expect(Permission.bulkCreate).toHaveBeenCalledWith(expect.arrayContaining([
            { name: "juices:view" }, { name: "juices:create" }, { name: "juices:edit" }, { name: "juices:delete" }, { name: "juiceConfig:edit" },
        ]), { ignoreDuplicates: true })
    } finally { log.mockRestore() }
})

test.each([es, en])("juice errors and resource names exist in each backend locale", locale => {
    for (const key of ["juice_duplicate", "juice_mix_ceiling", "juice_config_already_exists", "juice_config_required", "juice_config_conflict", "juice_cost_out_of_range", "juice_invalid_recipe", "juice_mix_incomplete", "juice_invalid_cost_input"]) {
        expect((locale.errors as Record<string, unknown>)[key]).toEqual(expect.any(String))
    }
    for (const key of ["Juice", "JuiceRawMaterial", "JuicePresentation", "JuiceMix", "JuiceSpiceMaterial", "JuiceSpice", "JuiceCostConstants", "JuiceClientConstantOverride"]) {
        expect((locale.resources as Record<string, string>)[key]).toEqual(expect.any(String))
    }
    expect(locale.resourcePlurals.juices).toEqual(expect.any(String))
    expect(locale.resourcePlurals.juiceConfig).toEqual(expect.any(String))
    for (const key of ["juice_import_sheet", "juice_import_duplicate_header", "juice_import_workbook", "juice_import_columns", "juice_import_matrix_layout", "juice_import_reference", "juice_import_spice_unit", "juice_import_material_type", "juice_import_fraction", "juice_import_duplicate_component", "juice_import_price_mismatch", "juice_import_presentation_required"]) {
        expect((locale.errors as Record<string, unknown>)[key]).toEqual(expect.any(String))
    }
})
