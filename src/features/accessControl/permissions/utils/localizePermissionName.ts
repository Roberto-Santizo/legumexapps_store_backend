import { Request } from "express"
import Permission from "../models/permission.model"

const KNOWN_ACTIONS = new Set(["view", "create", "edit", "delete", "calculate"])

// System permissions (seeded) only store a technical "resource:action" name — no human text —
// so the app stays bilingual. The readable description is composed here at request time from
// i18next ("permissionActions" + "resourcePlurals"), the same way "resources.*" works elsewhere.
// Permissions created manually via the API keep whatever description was typed for them.
function localizePermissionName(req: Request, name: string, storedDescription: string | null): string | null {
    const [resource, action] = name.split(":")
    if (!resource || !action || !KNOWN_ACTIONS.has(action)) return storedDescription

    const resourceLabel = req.t(`resourcePlurals.${resource}`, { defaultValue: "" })
    if (!resourceLabel) return storedDescription

    const actionLabel = req.t(`permissionActions.${action}`)
    return `${actionLabel} ${resourceLabel}`
}

export function toPermissionResponse(req: Request, permission: Permission) {
    return {
        ...permission.toJSON(),
        description: localizePermissionName(req, permission.name, permission.description)
    }
}
