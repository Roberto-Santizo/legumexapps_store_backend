import { businessDayRangeFilter } from "../../../shared/utils/businessTime.util"
import type { AdminQuoteListQuery } from "../schemas/adminQuoteList.schema"
import { Op } from "sequelize"
import ProductVariant from "../../product/models/ProductVariant.model"
import Product from "../../product/models/Product.model"
import ProductTranslation from "../../product/models/ProductTranslation.model"
import ProductRawMaterial from "../../product/models/ProductRawMaterial.model"
import ProductIngredient from "../../product/models/ProductIngredient.model"
import SubCategory from "../../category/models/SubCategory.model"
import SubCategoryTranslation from "../../category/models/SubCategoryTranslation.model"
import Category from "../../category/models/Category.model"
import CategoryTranslation from "../../category/models/CategoryTranslation.model"
import RawMaterial from "../../rawMaterial/models/RawMaterial.model"
import RawMaterialTranslation from "../../rawMaterial/models/RawMaterialTranslation.model"
import Ingredient from "../../ingredient/models/Ingredient.model"
import IngredientTranslation from "../../ingredient/models/IngredientTranslation.model"
import Unit from "../../unit/models/Unit.model"
import Packaging from "../../packaging/models/Packaging.model"
import Presentation from "../../presentation/models/Presentation.model"
import ProductVariantPalletMaterial from "../../product/models/ProductVariantPalletMaterial.model"
import ProductVariantUnitMaterial from "../../product/models/ProductVariantUnitMaterial.model"
import ProductVariantIntermediateMaterial from "../../product/models/ProductVariantIntermediateMaterial.model"
import Destination from "../../destination/models/Destination.model"
import Salesperson from "../../salesperson/models/Salesperson.model"
import Quote from "../models/Quote.model"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { CalculateQuoteInput, SalespersonQuoteInput } from "../schemas/quote.schema"
import { quoteDraftService } from "../../quoteDraft/services/quoteDraft.service"
import { ContentLanguage, DEFAULT_CONTENT_LANGUAGE, pickTranslatedName } from "../../../shared/utils/translation.util"
import { toDecimal, sumMoney } from "../../../shared/utils/money.util"
import { normalizeOptionGroup } from "../../../shared/utils/optionGroup.util"
import Decimal from "decimal.js"
import {
    AdjustmentLine,
    IngredientLine,
    IntermediateMaterialLine,
    MIX_PERCENTAGE_TOLERANCE,
    PalletMaterialLine,
    PercentageCostLine,
    ProcessingCostLine,
    RawMaterialLine,
    TransportLine,
    UnitMaterialLine,
    assembleQuoteTotals,
    buildAdjustmentLine,
    buildCustomizableRawMaterials,
    buildIngredientLine,
    buildIntermediateMaterialLine,
    buildPalletMaterialLine,
    buildPercentageRawMaterialLine,
    buildPerWeightProcessingCostLines,
    buildTransportLine,
    buildUnitMaterialLine
} from "./quoteCostLines"
import { GroupedMaterialRow, bucketMaterialsByGroup, resolveMaterialsForQuote } from "./quoteMaterialSelection"

// La matemática por línea (materia prima, ingredientes, empaque por nivel, costos adicionales,
// transporte, ajuste y el total) vive en quoteCostLines.ts, y la resolución de grupos de opciones en
// quoteMaterialSelection.ts. Este archivo es el motor de PRODUCTOS DEFINIDOS: lee esos valores de la
// variante (SKU) y los pasa a los builders compartidos.

export interface QuoteCalculation {
    productVariantId: number
    // null cuando no se mandó destinationId -- ver TransportLine.destinationId en quoteCostLines.ts.
    destinationId: number | null
    productDisplayName: string
    variantLabel: string | null
    requestedPallets: number
    totalUnits: number
    boxesPerPallet: number
    rawMaterialCost: number
    ingredientCost: number
    unitPackagingCost: number
    intermediatePackagingCost: number
    processingCostTotal: number
    palletMaterialCost: number
    percentageCostTotal: number
    transportCost: number
    adjustmentCost: number
    totalCost: number
    breakdown: {
        rawMaterials: RawMaterialLine[]
        ingredients: IngredientLine[]
        unitMaterials: UnitMaterialLine[]
        // Array (no un único objeto o null) -- el nivel intermedio admite N filas fijas + N grupos
        // de opciones, igual que unit/pallet.
        intermediateMaterials: IntermediateMaterialLine[]
        processingCosts: ProcessingCostLine[]
        palletMaterials: PalletMaterialLine[]
        percentageCosts: PercentageCostLine[]
        transport: TransportLine
        adjustment: AdjustmentLine | null
        language: ContentLanguage
    }
}

// Receta fija (!Product.isCustomizable): el % de cada materia prima lo fija el admin
// (ProductRawMaterial.percentage) y el cliente nunca puede alterarlo: input.rawMaterialMix no se lee
// acá. Si el producto no tiene ninguna materia prima activa todavía, se devuelve $0 sin exigir peso
// neto ni que sume 100, para no romper variantes cuya receta aún no está cargada.
function buildFixedPercentageRawMaterials(
    productRawMaterials: ProductRawMaterial[],
    netWeightGrams: number,
    totalUnits: number,
    language: ContentLanguage
): RawMaterialLine[] {
    if (productRawMaterials.length === 0) return []

    if (!netWeightGrams || netWeightGrams <= 0) {
        throw new AppError(422, "errors.presentation_missing_net_weight")
    }

    const netWeight = toDecimal(netWeightGrams)
    const totalUnitsDecimal = toDecimal(totalUnits)

    let percentageTotal = new Decimal(0)
    const rawMaterials: RawMaterialLine[] = productRawMaterials.map(productRawMaterial => {
        const percentage = toDecimal(productRawMaterial.percentage ?? 0)
        percentageTotal = percentageTotal.plus(percentage)

        return buildPercentageRawMaterialLine(
            productRawMaterial.rawMaterialId,
            productRawMaterial.usedRawMaterial,
            percentage,
            netWeight,
            totalUnits,
            totalUnitsDecimal,
            language
        )
    })

    // Autoritativo (a diferencia del techo "blando" de productRawMaterial.service.ts, que solo
    // evita GUARDAR una receta que ya se pase de 100 mientras se arma fila por fila): acá SÍ debe
    // sumar 100 exacto (± tolerancia) porque se está cotizando de verdad. Clave de error distinta
    // a la del mix personalizable a propósito -- el significado para quien lo lee es otro ("este
    // producto está mal configurado", no "tu mezcla no cuadra").
    if (percentageTotal.minus(100).abs().greaterThan(MIX_PERCENTAGE_TOLERANCE)) {
        throw new AppError(422, "errors.fixed_recipe_percentage_must_total_100", { percentageTotal: percentageTotal.toDecimalPlaces(2).toNumber() })
    }

    return rawMaterials
}

async function loadQuoteVariant(productVariantId: number): Promise<{ variant: ProductVariant; bagsPerPallet: number }> {
    const variant = await ProductVariant.findOne({
        where: { id: productVariantId, isActive: true },
        include: [
            {
                model: Product,
                as: "parentProduct",
                include: [
                    {
                        model: ProductRawMaterial,
                        as: "productRawMaterials",
                        where: { isActive: true },
                        required: false,
                        include: [
                            {
                                model: RawMaterial,
                                as: "usedRawMaterial",
                                include: [
                                    { model: Unit, as: "costUnit" },
                                    { model: RawMaterialTranslation, as: "translations" }
                                ]
                            }
                        ]
                    },
                    {
                        model: ProductIngredient,
                        as: "productIngredients",
                        where: { isActive: true },
                        required: false,
                        include: [
                            {
                                model: Ingredient,
                                as: "usedIngredient",
                                include: [
                                    { model: Unit, as: "costUnit" },
                                    { model: IngredientTranslation, as: "translations" }
                                ]
                            }
                        ]
                    },
                    { model: ProductTranslation, as: "translations" }
                ]
            },
            { model: Presentation, as: "sizePresentation" },
            {
                model: ProductVariantPalletMaterial,
                as: "palletMaterials",
                where: { isActive: true },
                required: false,
                include: [{ model: Packaging, as: "usedPalletMaterial" }]
            },
            {
                model: ProductVariantUnitMaterial,
                as: "unitMaterials",
                where: { isActive: true },
                required: false,
                include: [{ model: Packaging, as: "usedUnitMaterial" }]
            },
            {
                // Se cargan TODAS las filas activas (fijas + de cada grupo), nunca solo
                // isDefault:true, porque resolveMaterialsForQuote necesita el set completo para
                // validar la elección del cliente (ver comentario ahí). Igual que unit/pallet.
                model: ProductVariantIntermediateMaterial,
                as: "intermediateMaterials",
                where: { isActive: true },
                required: false,
                include: [{ model: Packaging, as: "usedIntermediateMaterial" }]
            }
        ]
    })
    if (!variant) throw new NotFoundError("ProductVariant", productVariantId)

    if (!variant.boxesPerPallet || variant.boxesPerPallet <= 0 || !variant.bagsPerBox || variant.bagsPerBox <= 0) {
        throw new AppError(422, "errors.pallet_not_configured")
    }
    const bagsPerPallet = variant.boxesPerPallet * variant.bagsPerBox
    if ((variant.unitMaterials ?? []).length === 0) {
        throw new AppError(422, "errors.unit_materials_not_configured")
    }

    if ((variant.palletMaterials ?? []).length === 0) {
        throw new AppError(422, "errors.pallet_materials_not_configured")
    }

    return { variant, bagsPerPallet }
}

async function resolveQuoteDestination(destinationId: number | undefined): Promise<Destination | null> {
    const destination = destinationId
        ? await Destination.findOne({ where: { id: destinationId, isActive: true } })
        : null
    if (destinationId && !destination) throw new NotFoundError("Destination", destinationId)
    return destination
}

function variantNetWeightGrams(variant: ProductVariant): number {
    return Number(variant.sizePresentation?.netWeightGrams ?? 0)
}

function buildRawMaterialLines(
    variant: ProductVariant,
    input: CalculateQuoteInput,
    totalUnits: number,
    language: ContentLanguage
): RawMaterialLine[] {
    const netWeightGrams = variantNetWeightGrams(variant)
    // El cliente nunca puede alterar una receta fija: input.rawMaterialMix ni siquiera se lee acá
    // en ese caso -- los % vienen únicamente de ProductRawMaterial.percentage (fijados por el
    // admin), ver buildFixedPercentageRawMaterials.
    return variant.parentProduct?.isCustomizable
        ? buildCustomizableRawMaterials(
              variant.parentProduct.productRawMaterials ?? [],
              input.rawMaterialMix,
              netWeightGrams,
              totalUnits,
              language
          )
        : buildFixedPercentageRawMaterials(variant.parentProduct?.productRawMaterials ?? [], netWeightGrams, totalUnits, language)
}

// Ingredientes agregados (sal, azúcar...) -- fijados por el admin, el cliente nunca los toca, mismos
// para receta fija y personalizable (el request no trae nada para esto). Fuera del 100% de la
// receta: se costean como una porción EXTRA del peso neto (buildIngredientLine). Sin filas
// activas -> [] sin exigir peso neto (misma tolerancia "no configurado" que la receta fija).
function buildIngredientLines(variant: ProductVariant, totalUnits: number, language: ContentLanguage): IngredientLine[] {
    const productIngredients = variant.parentProduct?.productIngredients ?? []
    if (productIngredients.length === 0) return []

    const netWeightGrams = variantNetWeightGrams(variant)
    if (!netWeightGrams || netWeightGrams <= 0) {
        throw new AppError(422, "errors.presentation_missing_net_weight")
    }

    const netWeight = toDecimal(netWeightGrams)
    const totalUnitsDecimal = toDecimal(totalUnits)

    return [...productIngredients]
        .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
        .map(productIngredient =>
            buildIngredientLine(
                productIngredient.ingredientId,
                productIngredient.usedIngredient,
                productIngredient.grams,
                productIngredient.referenceNetWeightGrams,
                netWeight,
                totalUnits,
                totalUnitsDecimal,
                language
            )
        )
}

function buildVariantLabel(variant: ProductVariant, language: ContentLanguage): string {
    const unitsPerBoxLabel = language === "en" ? `${variant.bagsPerBox} units` : `${variant.bagsPerBox} und`
    const sizePart = variant.sizePresentation?.displayLabel
        ? `${unitsPerBoxLabel} × ${variant.sizePresentation.displayLabel}`
        : unitsPerBoxLabel
    const boxesPerPalletLabel = language === "en"
        ? `${variant.boxesPerPallet} boxes/pallet`
        : `${variant.boxesPerPallet} cajas/palet`
    return [sizePart, boxesPerPalletLabel].join(" · ")
}

async function calculateQuote(input: CalculateQuoteInput, language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE): Promise<QuoteCalculation> {
    const { variant, bagsPerPallet } = await loadQuoteVariant(input.productVariantId)
    const destination = await resolveQuoteDestination(input.destinationId)

    const requestedPallets = input.requestedPallets
    const totalUnits = requestedPallets * bagsPerPallet

    const rawMaterials = buildRawMaterialLines(variant, input, totalUnits, language)
    const rawMaterialCost = sumMoney(rawMaterials.map(line => line.lineTotal))

    const ingredients = buildIngredientLines(variant, totalUnits, language)
    const ingredientCost = sumMoney(ingredients.map(line => line.lineTotal))

    const resolvedUnitMaterials = resolveMaterialsForQuote(variant.unitMaterials ?? [], input.selectedUnitMaterialIds, "unit")
    const unitMaterials = resolvedUnitMaterials.map(unitMaterial =>
        buildUnitMaterialLine(
            unitMaterial.packagingId,
            unitMaterial.usedUnitMaterial,
            unitMaterial.optionGroup,
            unitMaterial.quantityPerUnit ?? 1,
            totalUnits
        )
    )
    const unitPackagingCost = sumMoney(unitMaterials.map(line => line.lineTotal))

    const resolvedIntermediateMaterials = resolveMaterialsForQuote(
        variant.intermediateMaterials ?? [],
        input.selectedIntermediateMaterialIds,
        "intermediate"
    )
    const intermediateMaterials = resolvedIntermediateMaterials.map(material =>
        buildIntermediateMaterialLine(
            material.packagingId,
            material.usedIntermediateMaterial,
            material.optionGroup,
            variant.unitsPerIntermediatePackage,
            totalUnits
        )
    )
    const intermediatePackagingCost = sumMoney(intermediateMaterials.map(line => line.lineTotal))

    const processingCosts = await buildPerWeightProcessingCostLines(variantNetWeightGrams(variant), totalUnits, language)
    const processingCostTotal = sumMoney(processingCosts.map(line => line.lineTotal))

    const resolvedPalletMaterials = resolveMaterialsForQuote(variant.palletMaterials ?? [], input.selectedPalletMaterialIds, "pallet")
    const palletMaterials = resolvedPalletMaterials.map(palletMaterial =>
        buildPalletMaterialLine(
            palletMaterial.packagingId,
            palletMaterial.usedPalletMaterial,
            palletMaterial.optionGroup,
            toDecimal(palletMaterial.quantityValue ?? 0).times(palletMaterial.quantityBasis === "per_box" ? variant.boxesPerPallet : 1).toString(),
            requestedPallets
        )
    )
    const palletMaterialCost = sumMoney(palletMaterials.map(line => line.lineTotal))

    const { transportCost, transport } = buildTransportLine(destination, language)
    const { adjustmentCost, adjustment } = buildAdjustmentLine(variant.parentProduct?.additionalCostPerUnit, totalUnits)

    // ingredientCost entra en la base igual que la materia prima (los "Costos adicionales" %
    // también aplican a los ingredientes) -- la base y el total se definen en assembleQuoteTotals.
    const { percentageCosts, percentageCostTotal, totalCost } = await assembleQuoteTotals(
        {
            rawMaterialCost,
            ingredientCost,
            unitPackagingCost,
            intermediatePackagingCost,
            processingCostTotal,
            palletMaterialCost,
            transportCost,
            adjustmentCost
        },
        language
    )

    const variantLabel = buildVariantLabel(variant, language)

    return {
        productVariantId: variant.id,
        destinationId: destination?.id ?? null,
        productDisplayName: pickTranslatedName(variant.parentProduct?.displayName ?? "", variant.parentProduct?.translations, language),
        variantLabel,
        requestedPallets,
        totalUnits,
        boxesPerPallet: variant.boxesPerPallet,
        rawMaterialCost,
        ingredientCost,
        unitPackagingCost,
        intermediatePackagingCost,
        processingCostTotal,
        palletMaterialCost,
        percentageCostTotal,
        transportCost,
        adjustmentCost,
        totalCost,
        breakdown: {
            rawMaterials,
            ingredients,
            unitMaterials,
            intermediateMaterials,
            processingCosts,
            palletMaterials,
            percentageCosts,
            transport,
            adjustment,
            language
        }
    }
}

// Grupos de opciones: el menú de alternativas de un nivel para que
// el cliente elija al cotizar, ya agrupado por el backend -- un chooser por grupo (ej. "Caja" y
// "Esquinero" en paletización). Solo filas con optionGroup (las fijas nunca son una "opción",
// siempre se costean solas). `id` es el id de la FILA del join
// (ProductVariantUnitMaterial/IntermediateMaterial/PalletMaterial), el mismo que
// calculateQuoteSchema.selectedXMaterialIds espera -- no el packagingId.
interface QuotableMaterialOption {
    id: number
    packagingId: number
    displayName: string
    unitCost: number
    isDefault: boolean
}

interface QuotableMaterialOptionGroup {
    group: string
    groupId?: number
    options: QuotableMaterialOption[]
}

// Mismo agrupamiento que resolveMaterialsForQuote (bucketMaterialsByGroup), así el menú que ve el
// cliente y lo que el motor acepta nunca pueden divergir.
function buildMaterialOptionGroups<T extends GroupedMaterialRow & { packagingId: number }>(
    rows: T[],
    packagingOf: (row: T) => Packaging | undefined
): QuotableMaterialOptionGroup[] {
    const { groups } = bucketMaterialsByGroup(rows)
    return [...groups.values()].map(bucket => ({
        group: bucket.label,
        ...(bucket.rows[0]?.optionGroupId != null ? { groupId: bucket.rows[0].optionGroupId } : {}),
        options: bucket.rows.map(row => ({
            id: row.id as number,
            packagingId: row.packagingId,
            displayName: packagingOf(row)?.displayName ?? "",
            unitCost: Number(packagingOf(row)?.unitCost ?? 0),
            isDefault: row.isDefault
        }))
    }))
}

interface QuotableVariant {
    id: number
    boxesPerPallet: number
    bagsPerBox: number
    presentationLabel: string | null
    // Peso neto por bolsa/unidad en gramos, expuesto para que el frontend calcule el peso total del
    // pedido sin tocar calculateQuote. null si la Presentation no tiene el dato (defensivo).
    netWeightGrams: number | null
    packagingLabel: string | null
    unitMaterialOptionGroups: QuotableMaterialOptionGroup[]
    intermediateMaterialOptionGroups: QuotableMaterialOptionGroup[]
    palletMaterialOptionGroups: QuotableMaterialOptionGroup[]
}

interface QuotableRawMaterialOption {
    rawMaterialId: number
    displayName: string
    isOrganic: boolean
    minPercentage: number
    maxPercentage: number
}

// Receta fija (!isCustomizable): el % lo fija el admin y el cliente nunca lo puede alterar (ver
// buildFixedPercentageRawMaterials en este mismo archivo) -- pero SÍ debe poder VER qué está
// cotizando (ej. "100% Piña" / "50% Banano · 50% Fresa"). Distinto de QuotableRawMaterialOption
// (el pool editable del mix personalizable) a propósito: son conceptos diferentes, no la misma
// forma con un campo de más.
interface QuotableFixedRawMaterial {
    rawMaterialId: number
    displayName: string
    percentage: number
}

interface QuotableProduct {
    id: number
    displayName: string
    isOrganic: boolean
    isCustomizable: boolean
    imageUrl: string | null
    categoryId: number
    categoryName: string
    categoryImageUrl: string | null
    subCategoryId: number
    subCategoryName: string
    subCategoryImageUrl: string | null
    rawMaterialPool: QuotableRawMaterialOption[]
    fixedRecipe: QuotableFixedRawMaterial[]
    variants: QuotableVariant[]
}


async function listQuotableProducts(language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE): Promise<QuotableProduct[]> {
    const products = await Product.findAll({
        where: { isActive: true },
        include: [
            {
                model: ProductVariant,
                as: "productVariants",
                required: true,
                // presentationId ya es NOT NULL a nivel de columna; este filtro es defensa en profundidad, igual
                // que boxesPerPallet/bagsPerBox.
                where: {
                    isActive: true,
                    presentationId: { [Op.not]: null },
                    boxesPerPallet: { [Op.not]: null },
                    bagsPerBox: { [Op.not]: null }
                },
                include: [
                    { model: Presentation, as: "sizePresentation" },
                    {
                        model: ProductVariantUnitMaterial,
                        as: "unitMaterials",
                        where: { isActive: true },
                        required: false,
                        include: [{ model: Packaging, as: "usedUnitMaterial" }]
                    },
                    {
                        model: ProductVariantIntermediateMaterial,
                        as: "intermediateMaterials",
                        where: { isActive: true },
                        required: false,
                        include: [{ model: Packaging, as: "usedIntermediateMaterial" }]
                    },
                    {
                        model: ProductVariantPalletMaterial,
                        as: "palletMaterials",
                        where: { isActive: true },
                        required: false,
                        include: [{ model: Packaging, as: "usedPalletMaterial" }]
                    }
                ]
            },
            {
                model: SubCategory,
                as: "parentSubCategory",
                include: [{ model: SubCategoryTranslation, as: "translations" }, {
                    model: Category,
                    as: "parentCategory",
                    include: [{ model: CategoryTranslation, as: "translations" }]
                }]
            },
            {
                model: ProductRawMaterial,
                as: "productRawMaterials",
                required: false,
                where: { isActive: true },
                include: [{
                    model: RawMaterial,
                    as: "usedRawMaterial",
                    include: [{ model: RawMaterialTranslation, as: "translations" }]
                }]
            },
            { model: ProductTranslation, as: "translations" }
        ],
        order: [["displayName", "ASC"]]
    })

    return products.map(product => {
        const plain = product.toJSON()
        const category = plain.parentSubCategory?.parentCategory
        return {
            id: plain.id,
            displayName: pickTranslatedName(plain.displayName, plain.translations, language),
            isOrganic: plain.isOrganic,
            isCustomizable: plain.isCustomizable,
            imageUrl: plain.imageUrl ?? null,
            categoryId: category?.id ?? 0,
            categoryName: pickTranslatedName(category?.displayName ?? "", category?.translations, language),
            categoryImageUrl: category?.imageUrl ?? null,
            subCategoryId: plain.subCategoryId,
            subCategoryName: pickTranslatedName(plain.parentSubCategory?.displayName ?? "", plain.parentSubCategory?.translations, language),
            subCategoryImageUrl: plain.parentSubCategory?.imageUrl ?? null,
            rawMaterialPool: plain.isCustomizable
                ? (plain.productRawMaterials ?? []).map((productRawMaterial: ProductRawMaterial) => ({
                      rawMaterialId: productRawMaterial.rawMaterialId,
                      displayName: pickTranslatedName(productRawMaterial.usedRawMaterial?.displayName ?? "", productRawMaterial.usedRawMaterial?.translations, language),
                      isOrganic: productRawMaterial.usedRawMaterial?.isOrganic ?? false,
                      minPercentage: productRawMaterial.minPercentage !== null && productRawMaterial.minPercentage !== undefined
                          ? Number(productRawMaterial.minPercentage)
                          : 0,
                      maxPercentage: productRawMaterial.maxPercentage !== null && productRawMaterial.maxPercentage !== undefined
                          ? Number(productRawMaterial.maxPercentage)
                          : 100
                  }))
                : [],
            // El cliente no puede editar una receta fija, pero sí debe ver qué está cotizando --
            // ver comentario de QuotableFixedRawMaterial arriba.
            fixedRecipe: plain.isCustomizable
                ? []
                : (plain.productRawMaterials ?? []).map((productRawMaterial: ProductRawMaterial) => ({
                      rawMaterialId: productRawMaterial.rawMaterialId,
                      displayName: pickTranslatedName(productRawMaterial.usedRawMaterial?.displayName ?? "", productRawMaterial.usedRawMaterial?.translations, language),
                      percentage: productRawMaterial.percentage !== null && productRawMaterial.percentage !== undefined
                          ? Number(productRawMaterial.percentage)
                          : 0
                  })),
            variants: (plain.productVariants ?? []).map((variant: ProductVariant) => ({
                id: variant.id,
                boxesPerPallet: variant.boxesPerPallet as number,
                bagsPerBox: variant.bagsPerBox as number,
                presentationLabel: variant.sizePresentation?.displayLabel ?? null,
                // Presentation.netWeightGrams es DECIMAL: pg lo devuelve como string pese al tipo TS del modelo,
                // así que se castea con Number(...) como el resto de DECIMAL de este DTO.
                netWeightGrams: variant.sizePresentation?.netWeightGrams != null ? Number(variant.sizePresentation.netWeightGrams) : null,
                // Muestra lo que se costea por defecto (filas fijas + el default de cada grupo). Un grupo sin
                // default se omite acá sin reventar; el guard autoritativo vive en calculateQuote.
                packagingLabel:
                    (variant.unitMaterials ?? [])
                        .filter(unitMaterial => normalizeOptionGroup(unitMaterial.optionGroup) === null || unitMaterial.isDefault)
                        .map(unitMaterial => unitMaterial.usedUnitMaterial?.displayName)
                        .filter(Boolean)
                        .join(" + ") || null,
                unitMaterialOptionGroups: buildMaterialOptionGroups(variant.unitMaterials ?? [], row => row.usedUnitMaterial),
                intermediateMaterialOptionGroups: buildMaterialOptionGroups(
                    variant.intermediateMaterials ?? [],
                    row => row.usedIntermediateMaterial
                ),
                palletMaterialOptionGroups: buildMaterialOptionGroups(variant.palletMaterials ?? [], row => row.usedPalletMaterial)
            }))
        }
    })
}

async function listQuoteDestinations(): Promise<Destination[]> {
    return Destination.findAll({ where: { isActive: true }, order: [["displayName", "ASC"]] })
}


// Una cotización guardada no captura ni vincula un prospecto (Lead).
// draftKey (opcional, solo del wizard del representante) no participa del cálculo ni del Quote.create:
// se separa antes de calcular y solo se usa DESPUÉS de crear la cotización, para marcar el borrador
// como convertido (best-effort: si eso falla, la cotización ya quedó guardada y se devuelve igual).
async function saveQuote(salespersonId: number, input: SalespersonQuoteInput, language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE): Promise<QuoteCalculation & { id: number; createdAt: Date }> {
    const { draftKey, ...calculationInput } = input
    const calculation = await calculateQuote(calculationInput, language)

    const quote = await Quote.create({
        salespersonId,
        productVariantId: calculation.productVariantId,
        destinationId: calculation.destinationId,
        productDisplayName: calculation.productDisplayName,
        variantLabel: calculation.variantLabel,
        requestedPallets: calculation.requestedPallets,
        totalUnits: calculation.totalUnits,
        rawMaterialCost: calculation.rawMaterialCost,
        ingredientCost: calculation.ingredientCost,
        unitPackagingCost: calculation.unitPackagingCost,
        intermediatePackagingCost: calculation.intermediatePackagingCost,
        processingCostTotal: calculation.processingCostTotal,
        palletMaterialCost: calculation.palletMaterialCost,
        percentageCostTotal: calculation.percentageCostTotal,
        transportCost: calculation.transportCost,
        adjustmentCost: calculation.adjustmentCost,
        totalCost: calculation.totalCost,
        breakdown: calculation.breakdown
    })

    if (draftKey) {
        try {
            await quoteDraftService.markConverted(draftKey, salespersonId, quote.id)
        } catch (error) {
            console.error("[quoteDraft] no se pudo marcar el borrador como convertido", error)
        }
    }

    return {
        ...calculation,
        id: quote.id,
        createdAt: quote.get("createdAt") as Date
    }
}


async function listAllQuotes(filters: AdminQuoteListQuery = {}): Promise<Quote[]> {
    const createdAt = businessDayRangeFilter(filters.startDate, filters.endDate)
    return Quote.findAll({
        ...(createdAt ? { where: { createdAt } } : {}),
        include: [
            { model: Salesperson, as: "quotingSalesperson", attributes: ["id", "name", "companyName", "email"] }
        ],
        order: [["createdAt", "DESC"]]
    })
}

export const quoteService = {
    calculateQuote,
    listQuotableProducts,
    listQuoteDestinations,
    saveQuote,
    listAllQuotes,
}
