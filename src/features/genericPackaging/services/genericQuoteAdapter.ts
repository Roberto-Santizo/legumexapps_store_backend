import { AppError } from "../../../shared/errors/AppError";
import { packagingNames } from "../../../shared/utils/packagingName.util";
import { digest } from "../../../shared/utils/digest.util";
import { validGenericOption, validateGenericProfile, type GenericProfile, type GenericGroup } from "./genericPackagingResolver";
export function genericConfigurationOption(profile: GenericProfile) {
    let issue: string | null = null;
    let issueGroup = "";
    try {
        validateGenericProfile(profile);
    }
    catch (error) {
        issue = error instanceof AppError ? error.key : "errors.generic_packaging_configuration";
        issueGroup = error instanceof AppError ? String(error.params?.group ?? "") : "";
    }
    const option = (row: GenericGroup["options"][number]) => ({ id: row.id, packagingId: row.packagingId, ...packagingNames(row.packaging), isDefault: false });
    const level = (level: GenericGroup["level"]) => {
        const groups = profile.groups.filter(g => g.isActive && g.level === level);
        return { fixed: groups.filter(g => g.selectionMode === "all" && g.isRequired).flatMap(g => g.options.filter(o => o.isActive).map(option)),
            groups: groups.filter(g => !(g.selectionMode === "all" && g.isRequired)).map(g => ({ key: `id:${g.id}`, groupId: g.id, packagingGroupId: g.packagingGroupId, group: g.group.displayName, selectionMode: g.selectionMode, isRequired: g.isRequired,
                options: (g.selectionMode === "all" && g.options.some(o => o.isActive && !validGenericOption(o, g, profile)) ? [] : g.options.filter(o => validGenericOption(o, g, profile))).map(option) })) };
    };
    return { id: profile.id, configurationOrigin: "generic_configuration" as const, displayName: profile.displayName, fingerprint: digest(profile), configurationIssue: issue, configurationIssueGroup: issueGroup,
        presentationId: profile.presentationId, displayLabel: profile.presentation.displayLabel, netWeightGrams: Number(profile.presentation.netWeightGrams), bagsPerBox: profile.bagsPerBox, boxesPerPallet: profile.boxesPerPallet, unitsPerIntermediatePackage: profile.unitsPerIntermediatePackage,
        packaging: { unit: level("unit"), intermediate: level("intermediate"), pallet: level("pallet") } };
}
