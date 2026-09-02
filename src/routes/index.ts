import { Router } from "express"
import categoryRouter from "../features/category/routes/category.routes"
import subCategoryRouter from "../features/category/routes/subCategory.routes"
import productRouter from "../features/product/routes/product.routes"
import productTypeRouter from "../features/product-type/routes/productType.routes"
import unitRouter from "../features/unit/routes/unit.routes"
import packagingRouter from "../features/packaging/routes/packaging.routes"
import presentationRouter from "../features/presentation/routes/presentation.routes"
import ingredientRouter from "../features/ingredient/routes/ingredient.routes"
import destinationRouter from "../features/destination/routes/destination.routes"
import productVariantRouter from "../features/product/routes/productVariant.routes"
import productIngredientRouter from "../features/product/routes/productIngredient.routes"
import productVariantPalletMaterialRouter from "../features/product/routes/productVariantPalletMaterial.routes"
import loginRouter from "../features/accessControl/login/routes/login.routes"
import userRouter from "../features/accessControl/user/routes/user.routes"
import roleRouter from "../features/accessControl/roles/routes/role.routes"
import permissionRouter from "../features/accessControl/permissions/routes/permission.routes"
import rolePermissionRouter from "../features/accessControl/rolePermissions/routes/rolePermission.routes"
import customerRouter from "../features/customer/routes/customer.routes"
import customerLoginRouter from "../features/customer/routes/customerLogin.routes"
import quoteRouter from "../features/quote/routes/quote.routes"
import adminQuoteRouter from "../features/quote/routes/adminQuote.routes"
import dashboardRouter from "../features/dashboard/routes/dashboard.routes"

const appRouter = Router()

appRouter.use("/login", loginRouter)
appRouter.use("/users", userRouter)
appRouter.use("/roles", roleRouter)
appRouter.use("/roles", rolePermissionRouter)
appRouter.use("/permissions", permissionRouter)
appRouter.use("/customers", customerRouter)
appRouter.use("/customer-login", customerLoginRouter)
appRouter.use("/quotes", quoteRouter)
appRouter.use("/admin/quotes", adminQuoteRouter)
appRouter.use("/admin/dashboard", dashboardRouter)

appRouter.use("/categories", categoryRouter)
appRouter.use("/sub-categories", subCategoryRouter)
appRouter.use("/products", productRouter)
appRouter.use("/product-types", productTypeRouter)
appRouter.use("/units", unitRouter)
appRouter.use("/packagings", packagingRouter)
appRouter.use("/presentations", presentationRouter)
appRouter.use("/ingredients", ingredientRouter)
appRouter.use("/destinations", destinationRouter)
appRouter.use("/product-variants", productVariantRouter)
appRouter.use("/product-ingredients", productIngredientRouter)
appRouter.use("/product-variant-pallet-materials", productVariantPalletMaterialRouter)

export default appRouter
