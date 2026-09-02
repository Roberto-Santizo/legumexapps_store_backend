import bcrypt from "bcryptjs"
import colors from "colors"
import { env } from "../../config/env"
import User from "../../features/accessControl/user/models/user.model"
import Role from "../../features/accessControl/roles/models/role.model"
import Permission from "../../features/accessControl/permissions/models/permission.model"
import RolePermission from "../../features/accessControl/rolePermissions/models/rolePermission.model"

const ADMIN_ROLE_NAME = "Administrador"
const PASSWORD_SALT_ROUNDS = 10

const RESOURCE_KEYS = [
    "categories",
    "subCategories",
    "products",
    "productTypes",
    "units",
    "presentations",
    "packagings",
    "ingredients",
    "destinations",
    "users",
    "roles",
    "permissions",
    "customers",
]

const ACTION_SUFFIXES = ["view", "create", "edit", "delete"] as const
const EXTRA_PERMISSIONS = [
    { name: "quotes:view" },
    { name: "quotes:calculate" },
    { name: "dashboard:view" },
]

const PERMISSIONS = [
    ...RESOURCE_KEYS.flatMap(resourceKey =>
        ACTION_SUFFIXES.map(actionSuffix => ({
            name: `${resourceKey}:${actionSuffix}`,
        }))
    ),
    ...EXTRA_PERMISSIONS,
]

async function seedPermissions(): Promise<void> {
    await Permission.bulkCreate(PERMISSIONS, { ignoreDuplicates: true })
}

async function seedAdminRoleWithAllPermissions(): Promise<Role> {
    const [adminRole] = await Role.findOrCreate({
        where: { name: ADMIN_ROLE_NAME },
        defaults: { name: ADMIN_ROLE_NAME }
    })

    const allPermissions = await Permission.findAll({ attributes: ["id"] })
    if (allPermissions.length > 0) {
        await RolePermission.bulkCreate(
            allPermissions.map(permission => ({ role_id: adminRole.id, permission_id: permission.id })),
            { ignoreDuplicates: true }
        )
    }

    return adminRole
}

async function seedAdminUser(adminRole: Role): Promise<void> {
    const { seedAdminUsername, seedAdminPassword } = env
    if (!seedAdminUsername || !seedAdminPassword) {
        console.log(colors.yellow("SEED_ADMIN_USERNAME/SEED_ADMIN_PASSWORD no definidos: se omite la creación del usuario administrador"))
        return
    }

    const existingUser = await User.findOne({ where: { username: seedAdminUsername } })
    if (existingUser) return

    const hashedPassword = await bcrypt.hash(seedAdminPassword, PASSWORD_SALT_ROUNDS)
    await User.create({
        name: seedAdminUsername,
        username: seedAdminUsername,
        password: hashedPassword,
        role_id: adminRole.id
    })
}

export async function seedAccessControl(): Promise<void> {
    await seedPermissions()
    const adminRole = await seedAdminRoleWithAllPermissions()
    await seedAdminUser(adminRole)
}
