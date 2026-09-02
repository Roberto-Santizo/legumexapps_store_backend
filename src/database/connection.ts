import { Sequelize } from "sequelize-typescript"
import colors from "colors"
import { env } from "../config/env"
import { runSeeders } from "./seeders"

import Category from "../features/category/models/Category.model"
import CategoryTranslation from "../features/category/models/CategoryTranslation.model"
import SubCategory from "../features/category/models/SubCategory.model"
import SubCategoryTranslation from "../features/category/models/SubCategoryTranslation.model"
import Product from "../features/product/models/Product.model"
import ProductTranslation from "../features/product/models/ProductTranslation.model"
import ProductVariant from "../features/product/models/ProductVariant.model"
import ProductIngredient from "../features/product/models/ProductIngredient.model"
import ProductVariantPalletMaterial from "../features/product/models/ProductVariantPalletMaterial.model"
import ProductType from "../features/product-type/models/ProductType.model"
import Unit from "../features/unit/models/Unit.model"
import Presentation from "../features/presentation/models/Presentation.model"
import Packaging from "../features/packaging/models/Packaging.model"
import Ingredient from "../features/ingredient/models/Ingredient.model"
import IngredientTranslation from "../features/ingredient/models/IngredientTranslation.model"
import Destination from "../features/destination/models/Destination.model"
import User from "../features/accessControl/user/models/user.model"
import Role from "../features/accessControl/roles/models/role.model"
import Permission from "../features/accessControl/permissions/models/permission.model"
import RolePermission from "../features/accessControl/rolePermissions/models/rolePermission.model"
import Customer from "../features/customer/models/Customer.model"
import Quote from "../features/quote/models/Quote.model"

const sequelize = new Sequelize(env.databaseUrl, {
    logging: env.nodeEnv === "development" ? console.log : false,
    minifyAliases: true,
    dialectOptions: {
        ssl: {
            require: true,
            rejectUnauthorized: false
        }
    },
    models: [
        Category,
        CategoryTranslation,
        SubCategory,
        SubCategoryTranslation,
        Product,
        ProductTranslation,
        ProductVariant,
        ProductIngredient,
        ProductVariantPalletMaterial,
        ProductType,
        Unit,
        Presentation,
        Packaging,
        Ingredient,
        IngredientTranslation,
        Destination,
        User,
        Role,
        Permission,
        RolePermission,
        Customer,
        Quote
    ]
})

export async function connectDB(): Promise<void> {
    try {
        await sequelize.authenticate()
        const shouldAlter = env.dbSyncAlter && env.nodeEnv !== "production"
        await sequelize.sync({ alter: shouldAlter })
        await runSeeders()
        console.log(colors.green.bold("Database connection established successfully"))
    } catch (error) {
        console.error(colors.red.bold("Unable to connect to the database:"))
        console.error(error)
        process.exit(1)
    }
}

export default sequelize
