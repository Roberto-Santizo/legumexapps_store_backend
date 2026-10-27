import { PERMISSIONS } from "../../accessControl/permissions/constants/accessControlPolicy"
import es from "../../../locales/es/translation.json"
import en from "../../../locales/en/translation.json"

test("bootstrap policy includes only current juice permissions", () => {
    expect(PERMISSIONS).toEqual(expect.arrayContaining([
        {name:"juices:view"},{name:"juices:create"},{name:"juices:edit"},{name:"juices:delete"},
    ]))
})

test("retired juice administration permission is not granted", () => { expect(PERMISSIONS).not.toContainEqual({ name: "juiceConfig:edit" }) })

test.each([es, en])("juice errors and resource names exist in each backend locale", locale => {
    for (const key of ["juice_duplicate", "juice_mix_ceiling", "juice_cost_out_of_range", "juice_invalid_recipe", "juice_mix_incomplete", "juice_invalid_cost_input"]) {
        expect((locale.errors as Record<string, unknown>)[key]).toEqual(expect.any(String))
    }
    for (const key of ["Juice", "JuiceRawMaterial", "JuicePresentation", "JuiceMix", "JuiceSpiceMaterial", "JuiceSpice"]) {
        expect((locale.resources as Record<string, string>)[key]).toEqual(expect.any(String))
    }
    expect(locale.resourcePlurals.juices).toEqual(expect.any(String))
    expect(locale.errors).not.toHaveProperty("juice_import_price_mismatch")
    for (const key of ["juice_import_sheet", "juice_import_duplicate_header", "juice_import_workbook", "juice_import_columns", "juice_import_matrix_layout", "juice_import_reference", "juice_import_spice_unit", "juice_import_material_type", "juice_import_fraction", "juice_import_duplicate_component", "juice_import_presentation_required"]) {
        expect((locale.errors as Record<string, unknown>)[key]).toEqual(expect.any(String))
    }
})
