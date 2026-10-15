import { Request, Response, NextFunction } from "express"
import { rawMaterialTransformationService as service } from "../services/rawMaterialTransformation.service"
import type { RawMaterialTransformationDetail } from "../services/rawMaterialTransformation.service"
import { RawMaterialTransformationQuery } from "../schemas/rawMaterialTransformation.schema"

function processedMessage(req: Request, detail: RawMaterialTransformationDetail): string {
    return req.t("success.raw_material_transformation_processed", {
        code: detail.processedCode,
        cost: detail.processedCostUsd.toFixed(4),
    })
}

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { page, limit, search } = req.query as unknown as RawMaterialTransformationQuery
        res.json(await service.listTransformations({ page, limit }, search))
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        res.json({ data: await service.getTransformationById(Number(req.params.id)) })
    } catch (error) {
        next(error)
    }
}

async function sources(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        res.json({ data: await service.listSources() })
    } catch (error) {
        next(error)
    }
}

async function preview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        res.json({ data: service.previewTransformation(req.body) })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const detail = await service.createTransformation(req.body)
        res.status(201).json({ message: processedMessage(req, detail), data: detail })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const detail = await service.updateTransformation(Number(req.params.id), req.body)
        res.json({ message: processedMessage(req, detail), data: detail })
    } catch (error) {
        next(error)
    }
}

async function recalculate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const detail = await service.recalculateTransformation(Number(req.params.id))
        res.json({ message: processedMessage(req, detail), data: detail })
    } catch (error) {
        next(error)
    }
}

export const rawMaterialTransformationController = { index, show, sources, preview, store, update, recalculate }
