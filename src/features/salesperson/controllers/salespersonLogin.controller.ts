import { Request, Response, NextFunction } from "express"
import { salespersonLoginService } from "../services/salespersonLogin.service"

async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const result = await salespersonLoginService.login(req.body)
        res.json({ data: result })
    } catch (error) {
        next(error)
    }
}

export const salespersonLoginController = {
    login
}
