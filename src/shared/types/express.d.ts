import "express"

export interface AuthenticatedUser {
    id: number
    roleId: number
    roleName: string
    permissions: string[]
}

export interface AuthenticatedCustomer {
    id: number
}

declare module "express" {
    interface Request {
        user?: AuthenticatedUser
        customer?: AuthenticatedCustomer
    }
}
