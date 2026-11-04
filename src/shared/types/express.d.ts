import "express"

export interface AuthenticatedUser {
    id: number
    roleId: number
    roleName: string
    permissions: string[]
}

export interface AuthenticatedSalesperson {
    id: number
}

export interface AccountStatusReader {
    isStaffActive(id: number): Promise<boolean>
    isSalespersonActive(id: number): Promise<boolean>
}

declare global {
    namespace Express {
        interface Locals {
            accountStatus?: AccountStatusReader
        }
    }
}

declare module "express" {
    interface Request {
        user?: AuthenticatedUser
        salesperson?: AuthenticatedSalesperson
    }
}
