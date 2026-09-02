import { Request, Response, NextFunction } from "express"
import { customerLoginService } from "../services/customerLogin.service"

async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const result = await customerLoginService.login(req.body)
        res.json({ data: result })
    } catch (error) {
        next(error)
    }
}

export const customerLoginController = {
    login
}
