import z from "zod";
const id = z.number().int().positive();
const quantity = z.number().finite().positive().max(99999999.99).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001);
const genericMaterialSchema = z.strictObject({ packagingId: id, quantityBasis: z.enum(["per_unit", "per_intermediate", "per_box", "per_pallet"]), quantityValue: quantity.nullable() });
const genericGroupSchema = z.strictObject({ packagingGroupId: id, level: z.enum(["unit", "intermediate", "pallet"]), selectionMode: z.enum(["one", "all"]), isRequired: z.boolean(), options: z.array(genericMaterialSchema).max(100) });
export const genericConfigurationSchema = z.strictObject({ reference: z.string().trim().min(1).max(60), displayName: z.string().trim().min(1).max(120), categoryId: id, presentationId: id, bagsPerBox: id.max(100000), boxesPerPallet: id.max(100000), unitsPerIntermediatePackage: id.max(100000).nullable(), isActive: z.boolean(), groups: z.array(genericGroupSchema).max(100) }).superRefine((value, ctx) => {
    const keys = value.groups.map(group => `${group.level}:${group.packagingGroupId}`);
    keys.forEach((key, index) => {
        if (keys.indexOf(key) !== index)
            ctx.addIssue({ code: "custom", path: ["groups", index, "packagingGroupId"], message: "errors.generic_packaging_duplicate" });
    });
    value.groups.forEach((group, index) => {
        group.options.forEach((option, optionIndex) => {
            if (group.options.findIndex(row => row.packagingId === option.packagingId) !== optionIndex)
                ctx.addIssue({ code: "custom", path: ["groups", index, "options", optionIndex, "packagingId"], message: "errors.generic_packaging_duplicate" });
        });
        for (const [optionIndex, option] of group.options.entries()) {
            const valid = group.level === "unit" ? option.quantityBasis === "per_unit" && option.quantityValue != null
                : group.level === "intermediate" ? option.quantityBasis === "per_intermediate" && option.quantityValue === null && value.unitsPerIntermediatePackage != null
                    : ["per_box", "per_pallet"].includes(option.quantityBasis) && option.quantityValue != null;
            if (!valid)
                ctx.addIssue({ code: "custom", path: ["groups", index, "options", optionIndex, "quantityBasis"], message: "errors.generic_packaging_consumption" });
        }
    });
});
export const genericSelectionsSchema = z.array(z.strictObject({ groupId: id, optionIds: z.array(id).max(100) })).max(100);
export type GenericConfigurationInput = z.infer<typeof genericConfigurationSchema>;
