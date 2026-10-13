import type { Request, Response, NextFunction } from "express"
import { getFixedProductDetails } from "../services/productDetails.service"

export async function showFixedProductDetails(req: Request, res: Response, next: NextFunction): Promise<void> {
    try { res.json({ data: await getFixedProductDetails(Number(req.params.id)) }) }
    catch (error) { next(error) }
}
