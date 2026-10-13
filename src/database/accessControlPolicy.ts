export const ADMIN_ROLE_NAME = "Administrador"

const RESOURCE_KEYS = [
    "categories",
    "subCategories",
    "products",
    "juices",
    "units",
    "presentations",
    "packagings",
    "packagingGroups",
    "rawMaterials",
    "ingredients",
    "destinations",
    "processingCosts",
    "users",
    "roles",
    "permissions",
    "salespeople",
    "clients",
]

const ACTION_SUFFIXES = ["view", "create", "edit", "delete"] as const
const EXTRA_PERMISSIONS = [
    { name: "quotes:view" },
    { name: "quotes:calculate" },
    { name: "quoteDrafts:view" },
    { name: "juiceConfig:edit" },
    // Seguimiento de cotizaciones a la medida guardadas: ver (lista + detalle) y editar (estado).
    { name: "customQuotes:view" },
    { name: "customQuotes:edit" },
    { name: "dashboard:view" },
    { name: "leads:view" },
    { name: "leads:edit" },
    { name: "siteContent:edit" },
]

export const PERMISSIONS = [
    ...RESOURCE_KEYS.flatMap(resourceKey =>
        ACTION_SUFFIXES.map(actionSuffix => ({
            name: `${resourceKey}:${actionSuffix}`,
        }))
    ),
    ...EXTRA_PERMISSIONS]
