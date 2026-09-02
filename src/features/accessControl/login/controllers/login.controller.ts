import { Request, Response, NextFunction } from "express";
import { authService } from "../services/login.service";

async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const result = await authService.login(req.body)
        res.json({ data: result })
    } catch (error) {
        next(error)
    }
}

export const authController = {
    login
}
