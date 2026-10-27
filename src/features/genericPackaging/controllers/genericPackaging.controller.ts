import type { Request, Response, NextFunction } from "express";
import { packagingService } from "../../packaging/services/packaging.service";
import { createPackagingSchema } from "../../packaging/schemas/packaging.schema";
import { loadGenericProfiles, genericReadiness, genericCatalogOptions, saveGenericProfile } from "../services/genericPackaging.service";
import { buildGenericTemplate, planGenericImport, confirmGenericImport } from "../services/genericPackagingImport.service";
import { genericImportIssue } from "../utils/genericImportIssue";
import { AppError, BulkImportError } from "../../../shared/errors/AppError";
const handle = (work: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response, next: NextFunction) => { try {
    await work(req, res);
}
catch (error) {
    next(error);
} };
const file = (req: Request) => { if (!req.file)
    throw new AppError(422, "errors.bulk_import_missing_file"); return req.file.buffer; };
const routeId = (req: Request) => { const id = Number(req.params.id); if (!Number.isSafeInteger(id) || id <= 0)
    throw new AppError(422, "errors.generic_packaging_configuration"); return id; };
export const genericPackagingController = {
    list: handle(async (req, res) => { const profiles = await loadGenericProfiles(); res.json({ data: profiles.map(profile => ({ ...profile, groups: profile.groups.filter(g => g.isActive).map(g => ({ ...g, options: g.options.filter(o => o.isActive) })), ...genericReadiness(profile) })) }); }),
    options: handle(async (_req, res) => { res.json({ data: await genericCatalogOptions() }); }),
    create: handle(async (req, res) => { const id = await saveGenericProfile(req.body); res.status(201).json({ data: { id }, message: req.t("genericPackaging.saved") }); }),
    update: handle(async (req, res) => { const id = await saveGenericProfile(req.body, routeId(req)); res.json({ data: { id }, message: req.t("genericPackaging.saved") }); }),
    material: handle(async (req, res) => {
        if (req.body?.classification !== "generic")
            throw new AppError(422, "errors.generic_packaging_selection");
        const input = createPackagingSchema.parse(req.body);
        // Same service as the packaging catalog: a pallet "materialType" becomes its default consumption.
        const row = await packagingService.createPackaging(input);
        res.status(201).json({ data: row, message: req.t("genericPackaging.saved") });
    }),
    template: handle(async (_req, res) => { res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").attachment("configuraciones-empaques-genericos.xlsx").send(await buildGenericTemplate()); }),
    preview: handle(async (req, res) => { const plan = await planGenericImport(file(req)); res.json({ data: { previewHash: plan.previewHash, summary: plan.summary, issues: plan.issues.map(issue => genericImportIssue(req.t, issue)) } }); }),
    confirm: handle(async (req, res) => { if (!/^[a-f0-9]{64}$/.test(req.body.previewHash ?? ""))
        throw new AppError(422, "errors.generic_packaging_changed"); try {
            res.json({ data: await confirmGenericImport(file(req), req.body.previewHash), message: req.t("genericPackaging.saved") });
        } catch (error) {
            if (!(error instanceof BulkImportError)) throw error;
            res.status(error.statusCode).json({ message: req.t(error.key), details: error.rowIssues.map(issue => genericImportIssue(req.t, issue)) });
        } }),
};
