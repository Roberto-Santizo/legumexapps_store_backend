import { Request, Response, NextFunction } from "express"
import { customerService } from "../services/customer.service"
import { CustomerQuery } from "../schemas/customer.schema"

async function index(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { page, limit, search } = req.query as unknown as CustomerQuery
        const result = await customerService.listCustomers({ page, limit }, search)
        res.json(result)
    } catch (error) {
        next(error)
    }
}

async function show(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const customerId = Number(req.params.id)
        const customer = await customerService.getCustomerById(customerId)
        res.json({ data: customer })
    } catch (error) {
        next(error)
    }
}

async function store(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const customer = await customerService.createCustomer(req.body)
        res.status(201).json({
            message: req.t("success.created", { resource: req.t("resources.Customer") }),
            data: customer
        })
    } catch (error) {
        next(error)
    }
}

async function update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const customerId = Number(req.params.id)
        const customer = await customerService.updateCustomer(customerId, req.body)
        res.json({
            message: req.t("success.updated", { resource: req.t("resources.Customer") }),
            data: customer
        })
    } catch (error) {
        next(error)
    }
}

async function destroy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const customerId = Number(req.params.id)
        await customerService.deleteCustomer(customerId)
        res.json({ message: req.t("success.deleted", { resource: req.t("resources.Customer") }) })
    } catch (error) {
        next(error)
    }
}

async function updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const customerId = Number(req.params.id)
        const { isActive } = req.body
        const customer = await customerService.setCustomerStatus(customerId, isActive)
        res.json({
            message: req.t(isActive ? "success.activated" : "success.deactivated", { resource: req.t("resources.Customer") }),
            data: customer
        })
    } catch (error) {
        next(error)
    }
}

export const customerController = {
    index,
    show,
    store,
    update,
    destroy,
    updateStatus,
}
