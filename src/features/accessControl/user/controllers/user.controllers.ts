import { userService } from "../services/user.service";
import { Request,Response, NextFunction } from "express";
import { UserQuery } from "../schemas/user.schema";

async function index(req:Request, res:Response, next:NextFunction): Promise<void> {
    try {
        const { page, limit, search } = req.query as unknown as UserQuery
        const result = await userService.listUsers({ page, limit }, search)
        res.json(result)
    } catch (error) {
        next(error)
    }
}

async function show(req:Request, res:Response, next:NextFunction): Promise<void> {
    try {
        const userId = Number(req.params.id)
        const user = await userService.getUserById(userId)
        res.json({data:user})
    } catch (error) {
        next(error)
    }
}
async function store(req:Request, res:Response, next:NextFunction): Promise<void> {
    try {
        const user = await userService.createUser(req.body)
        res.status(201).json({
            message: req.t("success.created",{resource: req.t("resources.User")}),
            data: user
        })
    } catch (error) {
        next(error)
    }
}
async function update(req:Request, res:Response, next:NextFunction):Promise<void> {
    try {
        const userId = Number(req.params.id)
        const user = await userService.updateUser(userId, req.body)
        res.json({
            message: req.t("success.updated",{resource: req.t("resources.User")}),
            data:user
        })
    } catch (error) {
        next(error)
    }
}
async function destroy(req:Request, res:Response, next:NextFunction): Promise<void> {
    try {
        const userId = Number(req.params.id)
        await userService.deleteUser(userId)
        res.json({message:req.t("success.deleted",{resource:req.t("resources.User")})})
    } catch (error) {
        next(error)
    }
}

async function updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const userId = Number(req.params.id)
        const { isActive } = req.body
        const user = await userService.setUserStatus(userId, isActive)
        res.json({
            message: req.t(isActive ? "success.activated" : "success.deactivated", { resource: req.t("resources.User") }),
            data: user
        })
    } catch (error) {
        next(error)
    }
}

export const userController = {
    index,
    show,
    store,
    update,
    destroy,
    updateStatus,
}