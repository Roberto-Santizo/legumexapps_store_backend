import { AppError } from "../../../shared/errors/AppError";
import { toDecimal } from "../../../shared/utils/money.util";
import { isPalletKitType } from "../../packaging/constants/packagingMaterialType.constant";
export interface GenericOption {
    id: number;
    packagingId: number;
    quantityBasis: string;
    quantityValue: number | string | null;
    isActive: boolean;
    packaging: {
        id?: number;
        classification: string;
        packagingRole: string;
        isActive: boolean;
        unitCost: number | string | null;
        displayName: string;
        displayNameEn?: string | null;
        code?: string;
        materialType?: string;
    };
}
export interface GenericGroup {
    id: number;
    packagingGroupId: number;
    level: "unit" | "intermediate" | "pallet";
    selectionMode: "one" | "all";
    isRequired: boolean;
    isActive: boolean;
    group: {
        displayName: string;
        isActive: boolean;
    };
    options: GenericOption[];
}
export interface GenericProfile {
    id: number;
    reference: string;
    displayName: string;
    categoryId: number;
    presentationId: number;
    bagsPerBox: number;
    boxesPerPallet: number;
    unitsPerIntermediatePackage: number | null;
    isActive: boolean;
    category?: {
        isActive: boolean;
    };
    presentation: {
        displayLabel: string;
        netWeightGrams: number | string | null;
        isActive: boolean;
    };
    groups: GenericGroup[];
}
export const genericError = (reason: string, group?: GenericGroup): never => { throw new AppError(422, `errors.generic_packaging_${reason}`, { group: group?.group?.displayName ?? "", groupId: group?.id }); };
export function validGenericOption(option: GenericOption, group: GenericGroup, profile: GenericProfile): boolean {
    const material = option.packaging;
    // Tarima, esquinero and stretch come from the pallet kit on every quote; inside a configuration they would be charged twice.
    if (!group.group?.isActive || !option.isActive || !material?.isActive || material.classification !== "generic" || material.packagingRole !== group.level || material.unitCost == null || isPalletKitType(material.materialType))
        return false;
    const cost = toDecimal(material.unitCost);
    if (!cost.isFinite() || cost.isNegative())
        return false;
    if (group.level === "intermediate")
        return option.quantityBasis === "per_intermediate" && option.quantityValue === null && Number.isSafeInteger(profile.unitsPerIntermediatePackage) && profile.unitsPerIntermediatePackage! > 0;
    const quantity = toDecimal(option.quantityValue);
    return option.quantityValue != null && quantity.isFinite() && quantity.greaterThan(0)
        && (group.level === "unit" ? option.quantityBasis === "per_unit" : ["per_box", "per_pallet"].includes(option.quantityBasis));
}
export function validateGenericProfile(profile: GenericProfile) {
    if (profile.category?.isActive === false || !profile.isActive || !profile.presentation?.isActive || profile.presentation.netWeightGrams == null || !toDecimal(profile.presentation.netWeightGrams).isFinite() || !toDecimal(profile.presentation.netWeightGrams).greaterThan(0)
        || ![profile.bagsPerBox, profile.boxesPerPallet].every(value => Number.isSafeInteger(value) && value > 0)
        || !Number.isSafeInteger(profile.bagsPerBox * profile.boxesPerPallet))
        genericError("configuration");
    const groups = profile.groups.filter(group => group.isActive);
    if (!groups.length)
        genericError("configuration");
    const materialIds = groups.flatMap(group => group.options.filter(option => option.isActive).map(option => option.packagingId));
    if (new Set(materialIds).size !== materialIds.length) genericError("duplicate");
    for (const group of groups) {
        if (!group.group?.isActive) {
            if (group.isRequired)
                genericError("unavailable", group);
            continue;
        }
        const active = group.options.filter(option => option.isActive);
        const valid = active.filter(option => validGenericOption(option, group, profile));
        if (group.isRequired && (!valid.length || (group.selectionMode === "all" && valid.length !== active.length)))
            genericError("unavailable", group);
    }
}
export function resolveGenericPackaging(profile: GenericProfile, selections: {
    groupId: number;
    optionIds: number[];
}[]) {
    validateGenericProfile(profile);
    const groups = profile.groups.filter(group => group.isActive);
    if (new Set(selections.map(row => row.groupId)).size !== selections.length)
        genericError("selection");
    for (const selection of selections)
        if (!groups.some(group => group.id === selection.groupId))
            genericError("selection");
    const resolved: {
        group: GenericGroup;
        option: GenericOption;
        origin: "included" | "selected";
    }[] = [];
    for (const group of groups) {
        const choice = selections.find(row => row.groupId === group.id);
        if (group.selectionMode === "all" && group.isRequired) {
            if (choice)
                genericError("selection", group);
            for (const option of group.options.filter(row => row.isActive))
                resolved.push({ group, option, origin: "included" });
            continue;
        }
        const ids = choice?.optionIds ?? [];
        if (new Set(ids).size !== ids.length || (group.selectionMode === "one" && ids.length > 1))
            genericError("selection", group);
        if (!ids.length) {
            if (group.isRequired)
                genericError("required", group);
            continue;
        }
        const options = ids.map(id => group.options.find(option => option.id === id && validGenericOption(option, group, profile)));
        if (options.some(option => !option))
            genericError("selection", group);
        if (group.selectionMode === "all") {
            const active = group.options.filter(option => option.isActive);
            if (active.length !== ids.length || active.some(option => !validGenericOption(option, group, profile)))
                genericError("unavailable", group);
        }
        for (const option of options)
            resolved.push({ group, option: option!, origin: "selected" });
    }
    if (new Set(resolved.map(row => row.option.packagingId)).size !== resolved.length)
        genericError("duplicate");
    return resolved;
}
