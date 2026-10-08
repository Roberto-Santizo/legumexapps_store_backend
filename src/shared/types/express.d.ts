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

declare module "express" {
    interface Request {
        user?: AuthenticatedUser
        salesperson?: AuthenticatedSalesperson
    }
}
