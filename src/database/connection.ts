import { Sequelize } from "sequelize-typescript"
import PackagingGroup from "../features/packagingGroup/models/PackagingGroup.model"
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
import ProductRawMaterial from "../features/product/models/ProductRawMaterial.model"
import ProductIngredient from "../features/product/models/ProductIngredient.model"
import ProductVariantPalletMaterial from "../features/product/models/ProductVariantPalletMaterial.model"
import ProductVariantUnitMaterial from "../features/product/models/ProductVariantUnitMaterial.model"
import ProductVariantIntermediateMaterial from "../features/product/models/ProductVariantIntermediateMaterial.model"
import Unit from "../features/unit/models/Unit.model"
import Presentation from "../features/presentation/models/Presentation.model"
import Packaging from "../features/packaging/models/Packaging.model"
import RawMaterial from "../features/rawMaterial/models/RawMaterial.model"
import RawMaterialTranslation from "../features/rawMaterial/models/RawMaterialTranslation.model"
import Ingredient from "../features/ingredient/models/Ingredient.model"
import IngredientTranslation from "../features/ingredient/models/IngredientTranslation.model"
import Destination from "../features/destination/models/Destination.model"
import User from "../features/accessControl/user/models/user.model"
import Role from "../features/accessControl/roles/models/role.model"
import Permission from "../features/accessControl/permissions/models/permission.model"
import RolePermission from "../features/accessControl/rolePermissions/models/rolePermission.model"
import Salesperson from "../features/salesperson/models/Salesperson.model"
import Client from "../features/client/models/Client.model"
import Quote from "../features/quote/models/Quote.model"
import QuoteDraft from "../features/quoteDraft/models/QuoteDraft.model"
import CustomQuoteRawMaterialOption from "../features/customQuote/models/CustomQuoteRawMaterialOption.model"
import CustomQuoteIngredientOption from "../features/customQuote/models/CustomQuoteIngredientOption.model"
import CustomQuotePresentationOption from "../features/customQuote/models/CustomQuotePresentationOption.model"
import CustomQuotePackagingOption from "../features/customQuote/models/CustomQuotePackagingOption.model"
import CustomQuote from "../features/customQuote/models/CustomQuote.model"
import ProcessingCost from "../features/processingCost/models/ProcessingCost.model"
import ProcessingCostTranslation from "../features/processingCost/models/ProcessingCostTranslation.model"
import Lead from "../features/lead/models/Lead.model"
import SiteImage from "../features/siteImage/models/SiteImage.model"

import JuiceRawMaterial from "../features/juice/models/JuiceRawMaterial.model"
import Juice from "../features/juice/models/Juice.model"
import JuicePresentation from "../features/juice/models/JuicePresentation.model"
import JuiceMix from "../features/juice/models/JuiceMix.model"
import JuiceSpiceMaterial from "../features/juice/models/JuiceSpiceMaterial.model"
import JuiceSpice from "../features/juice/models/JuiceSpice.model"
import JuiceCostConstants from "../features/juice/models/JuiceCostConstants.model"
import JuiceClientConstantOverride from "../features/juice/models/JuiceClientConstantOverride.model"

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
        PackagingGroup,
        Category,
        CategoryTranslation,
        SubCategory,
        SubCategoryTranslation,
        Product,
        ProductTranslation,
        ProductVariant,
        ProductRawMaterial,
        ProductIngredient,
        ProductVariantPalletMaterial,
        ProductVariantUnitMaterial,
        ProductVariantIntermediateMaterial,
        Unit,
        Presentation,
        Packaging,
        RawMaterial,
        RawMaterialTranslation,
        Ingredient,
        IngredientTranslation,
        Destination,
        User,
        Role,
        Permission,
        RolePermission,
        Salesperson,
        Client,
        Quote,
        QuoteDraft,
        CustomQuoteRawMaterialOption,
        CustomQuoteIngredientOption,
        CustomQuotePresentationOption,
        CustomQuotePackagingOption,
        CustomQuote,
        ProcessingCost,
        ProcessingCostTranslation,
        Lead,
        SiteImage,
        JuiceRawMaterial,
        Juice,
        JuicePresentation,
        JuiceMix,
        JuiceSpiceMaterial,
        JuiceSpice,
        JuiceCostConstants,
        JuiceClientConstantOverride,
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
