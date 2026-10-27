import type { TFunction } from "i18next";
import type { RowIssue } from "../../../shared/errors/AppError";

/** Localize column labels and only include context actually supplied by the workbook. */
export function genericImportIssue(t: TFunction, issue: RowIssue) {
    const field = t(`genericPackaging.importFields.${issue.field}`, { defaultValue: issue.field });
    const group = issue.params?.group;
    const material = issue.params?.material;
    const reason = t(issue.key, { ...issue.params, field });
    const context = group && material ? "importGroupMaterialContext" : group ? "importGroupContext" : material ? "importMaterialContext" : null;
    return { ...issue, field, message: context ? t(`genericPackaging.${context}`, {group, material, reason}) : reason };
}
