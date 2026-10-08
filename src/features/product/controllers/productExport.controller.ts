import { Request, Response, NextFunction } from "express"
import { productExportService } from "../services/productExport.service"

export async function exportProductCatalog(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const buffer = await productExportService.exportProductCatalog()
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        res.setHeader("Content-Disposition", `attachment; filename="catalogo-productos-${new Date().toISOString().slice(0, 10)}.xlsx"`)
        res.setHeader("Cache-Control", "no-store")
        res.send(buffer)
    } catch (error) { next(error) }
}
