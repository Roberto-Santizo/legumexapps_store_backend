import GenericPackagingConfiguration from "../features/genericPackaging/models/GenericPackagingConfiguration.model"
import GenericPackagingConfigurationGroup from "../features/genericPackaging/models/GenericPackagingConfigurationGroup.model"
import GenericPackagingConfigurationMaterial from "../features/genericPackaging/models/GenericPackagingConfigurationMaterial.model"
// Pure model registry: no environment loading, connection, sync, or seed operations.
import PackagingGroup from "../features/packagingGroup/models/PackagingGroup.model"
import PalletKitMaterial from "../features/palletKit/models/PalletKitMaterial.model"
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
import UnprocessedRawMaterial from "../features/rawMaterialTransformation/models/UnprocessedRawMaterial.model"
import RawMaterialTransformation from "../features/rawMaterialTransformation/models/RawMaterialTransformation.model"
import RawMaterialTransformationCost from "../features/rawMaterialTransformation/models/RawMaterialTransformationCost.model"
import Ingredient from "../features/ingredient/models/Ingredient.model"
import IngredientTranslation from "../features/ingredient/models/IngredientTranslation.model"
import Destination from "../features/destination/models/Destination.model"
import User from "../features/accessControl/user/models/User.model"
import Role from "../features/accessControl/roles/models/Role.model"
import Permission from "../features/accessControl/permissions/models/Permission.model"
import RolePermission from "../features/accessControl/rolePermissions/models/RolePermission.model"
import Salesperson from "../features/salesperson/models/Salesperson.model"
import Client from "../features/client/models/Client.model"
import RepresentativeClient from "../features/salesperson/models/RepresentativeClient.model"
import Quote from "../features/quote/models/Quote.model"
import QuoteDraft from "../features/quoteDraft/models/QuoteDraft.model"
import CustomQuote from "../features/customQuote/models/CustomQuote.model"
import QuoteOrderReview from "../features/quoteReview/models/QuoteOrderReview.model"
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

export const databaseModels = [
        GenericPackagingConfiguration,
        GenericPackagingConfigurationGroup,
        GenericPackagingConfigurationMaterial,

        PackagingGroup,
        PalletKitMaterial,
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
        UnprocessedRawMaterial,
        RawMaterialTransformation,
        RawMaterialTransformationCost,
        Ingredient,
        IngredientTranslation,
        Destination,
        User,
        Role,
        Permission,
        RolePermission,
        Salesperson,
        Client,
        RepresentativeClient,
        Quote,
        QuoteDraft,
        CustomQuote,
        QuoteOrderReview,
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
]
