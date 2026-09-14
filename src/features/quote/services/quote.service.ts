import { Op } from "sequelize"
import ProductVariant from "../../product/models/ProductVariant.model"
import Product from "../../product/models/Product.model"
import ProductTranslation from "../../product/models/ProductTranslation.model"
import ProductIngredient from "../../product/models/ProductIngredient.model"
import SubCategory from "../../category/models/SubCategory.model"
import Category from "../../category/models/Category.model"
import CategoryTranslation from "../../category/models/CategoryTranslation.model"
import Ingredient from "../../ingredient/models/Ingredient.model"
import IngredientTranslation from "../../ingredient/models/IngredientTranslation.model"
import Unit from "../../unit/models/Unit.model"
import Packaging from "../../packaging/models/Packaging.model"
import Presentation from "../../presentation/models/Presentation.model"
import ProductVariantPalletMaterial from "../../product/models/ProductVariantPalletMaterial.model"
import ProductVariantUnitMaterial from "../../product/models/ProductVariantUnitMaterial.model"
import ProductType from "../../product-type/models/ProductType.model"
import Destination from "../../destination/models/Destination.model"
import Customer from "../../customer/models/Customer.model"
import Quote from "../models/Quote.model"
import Lead from "../../lead/models/Lead.model"
import { leadService } from "../../lead/services/lead.service"
import ProcessingCost from "../../processingCost/models/ProcessingCost.model"
import ProcessingCostTranslation from "../../processingCost/models/ProcessingCostTranslation.model"
import { getUnitCatalogEntry } from "../../unit/constants/unitCatalog"
import { AppError, NotFoundError } from "../../../shared/errors/AppError"
import { CalculateQuoteInput, IngredientMixLineInput, SaveQuoteInput } from "../schemas/quote.schema"
import { ContentLanguage, DEFAULT_CONTENT_LANGUAGE, pickTranslatedName } from "../../../shared/utils/translation.util"
import { toDecimal, roundMoney, sumMoney } from "../../../shared/utils/money.util"
import Decimal from "decimal.js"

// Los costos adicionales ("Costos adicionales" en la UI, "ProcessingCost" en el código -- ver
// ProcessingCost.model.ts para por qué el nombre difiere) se definen "por libra" de materia
// prima. Se reutiliza el factor de conversión YA calibrado en el catálogo de Unidades (Libra =
// 453.592, la misma constante que usa Ingredient.costUnit en cualquier otra conversión de peso)
// en vez de hardcodear el número una segunda vez.
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- catálogo estático hardcodeado, "pound" siempre existe (ver unitCatalog.ts)
const GRAMS_PER_POUND = getUnitCatalogEntry("pound")!.baseFactor

interface RawMaterialLine {
    ingredientId: number
    displayName: string
    unitCost: number
    quantityPerUnit: number
    totalUnits: number
    lineTotal: number
}

interface UnitMaterialLine {
    packagingId: number
    displayName: string
    unitCost: number
    quantityPerUnit: number
    totalUnits: number
    lineTotal: number
}

interface IntermediatePackagingLine {
    packagingId: number
    displayName: string
    unitCost: number
    unitsPerPackage: number
    totalUnits: number
    packagesNeeded: number
    lineTotal: number
}

interface ProcessingCostLine {
    processingCostId: number
    displayName: string
    value: number
    totalWeightPounds: number
    lineTotal: number
}

interface PercentageCostLine {
    processingCostId: number
    displayName: string
    value: number
    baseAmount: number
    lineTotal: number
}

interface PalletMaterialLine {
    packagingId: number
    displayName: string
    unitCost: number
    quantityPerPallet: number
    requestedPallets: number
    lineTotal: number
}

interface TransportLine {
    // null cuando no se mandó destinationId (transporte "apagado" para el cliente, ver
    // calculateQuote) -- no se borró el shape, solo se admite el caso sin destino.
    destinationId: number | null
    displayName: string
    baseCost: number
}

interface AdjustmentLine {
    unitCost: number
    totalUnits: number
    lineTotal: number
}

interface QuoteCalculation {
    productVariantId: number
    // null cuando no se mandó destinationId -- ver TransportLine.destinationId arriba.
    destinationId: number | null
    productDisplayName: string
    variantLabel: string | null
    requestedPallets: number
    totalUnits: number
    // Cajas por palet (2026-09-12) -- se expone junto al resultado para que el reporte del
    // cliente pueda mostrar "cajas por palet" en vez de totalUnits (bolsas), que es un dato
    // interno. Es directamente variant.boxesPerPallet, sin transformar -- ver
    // QuoteResultCard/QuotePdfDocument para dónde se consume.
    boxesPerPallet: number
    rawMaterialCost: number
    unitPackagingCost: number
    intermediatePackagingCost: number
    // Nombrado "...Total", no "...Cost", a propósito: "ProcessingCost" ya termina en "Cost" --
    // seguir el patrón de sufijo de las demás líneas (ej. palletMaterialCost) habría dado
    // "processingCostCost", que repite la palabra sin sentido.
    processingCostTotal: number
    palletMaterialCost: number
    // Costos adicionales de tipo "percentage" (ej. "Imprevistos" 2%) -- se calculan al FINAL,
    // sobre el subtotal ya escalado de materia prima + costos por peso + empaques + materiales de
    // palet (ver percentageBase en calculateQuote). Nombrado "...Total" por el mismo motivo que
    // processingCostTotal arriba (el sufijo "+Cost" repetiría la palabra).
    percentageCostTotal: number
    transportCost: number
    adjustmentCost: number
    totalCost: number
    breakdown: {
        rawMaterials: RawMaterialLine[]
        unitMaterials: UnitMaterialLine[]
        intermediatePackaging: IntermediatePackagingLine | null
        processingCosts: ProcessingCostLine[]
        palletMaterials: PalletMaterialLine[]
        percentageCosts: PercentageCostLine[]
        transport: TransportLine
        adjustment: AdjustmentLine | null
        language: ContentLanguage
    }
}


const MIX_PERCENTAGE_TOLERANCE = new Decimal(0.5)

function buildFixedRecipeRawMaterials(
    productIngredients: ProductIngredient[],
    totalUnits: number,
    language: ContentLanguage
): RawMaterialLine[] {
    const totalUnitsDecimal = toDecimal(totalUnits)

    return productIngredients.map(productIngredient => {
        const ingredient = productIngredient.usedIngredient
        const unitCost = toDecimal(ingredient?.costPerUnit ?? 0)
        const rawQuantity = toDecimal(productIngredient.quantityValue ?? 0)
        const quantityUnit = productIngredient.quantityUnit
        const costUnit = ingredient?.costUnit

        let quantityPerUnit = rawQuantity
        if (quantityUnit && costUnit) {
            if (quantityUnit.unitType !== costUnit.unitType) {
                throw new AppError(422, "errors.product_ingredient_quantity_unit_type_mismatch", {
                    ingredientId: productIngredient.ingredientId,
                    quantityUnitType: quantityUnit.unitType,
                    costUnitType: costUnit.unitType
                })
            }
            quantityPerUnit = rawQuantity.times(toDecimal(quantityUnit.baseFactor)).dividedBy(toDecimal(costUnit.baseFactor))
        }

        const lineTotal = roundMoney(unitCost.times(quantityPerUnit).times(totalUnitsDecimal))

        return {
            ingredientId: productIngredient.ingredientId,
            displayName: pickTranslatedName(ingredient?.displayName ?? "", ingredient?.translations, language),
            unitCost: unitCost.toNumber(),
            quantityPerUnit: quantityPerUnit.toDecimalPlaces(6).toNumber(),
            totalUnits,
            lineTotal
        }
    })
}


function buildCustomizableRawMaterials(
    pool: ProductIngredient[],
    mix: IngredientMixLineInput[] | undefined,
    netWeightGrams: number,
    totalUnits: number,
    language: ContentLanguage
): RawMaterialLine[] {
    if (!mix || mix.length === 0) {
        throw new AppError(422, "errors.ingredient_mix_required")
    }
    if (!netWeightGrams || netWeightGrams <= 0) {
        throw new AppError(422, "errors.presentation_missing_net_weight")
    }

    const poolByIngredientId = new Map(pool.map(productIngredient => [productIngredient.ingredientId, productIngredient]))
    const seenIngredientIds = new Set<number>()
    const netWeight = toDecimal(netWeightGrams)
    const totalUnitsDecimal = toDecimal(totalUnits)

    let percentageTotal = new Decimal(0)
    const rawMaterials: RawMaterialLine[] = mix.map(mixLine => {
        if (seenIngredientIds.has(mixLine.ingredientId)) {
            throw new AppError(422, "errors.duplicate_ingredient_in_mix", { ingredientId: mixLine.ingredientId })
        }
        seenIngredientIds.add(mixLine.ingredientId)

        const poolEntry = poolByIngredientId.get(mixLine.ingredientId)
        if (!poolEntry) {
            throw new AppError(422, "errors.ingredient_not_in_pool", { ingredientId: mixLine.ingredientId })
        }

        const minPercentage = poolEntry.minPercentage !== null && poolEntry.minPercentage !== undefined ? Number(poolEntry.minPercentage) : 0
        const maxPercentage = poolEntry.maxPercentage !== null && poolEntry.maxPercentage !== undefined ? Number(poolEntry.maxPercentage) : 100
        if (mixLine.percentage < minPercentage || mixLine.percentage > maxPercentage) {
            throw new AppError(422, "errors.ingredient_percentage_out_of_range", {
                ingredientId: mixLine.ingredientId,
                minPercentage,
                maxPercentage
            })
        }

        const percentage = toDecimal(mixLine.percentage)
        percentageTotal = percentageTotal.plus(percentage)

        const ingredient = poolEntry.usedIngredient
        const unitCost = toDecimal(ingredient?.costPerUnit ?? 0)
        if (!ingredient?.costUnit) {
            throw new AppError(422, "errors.ingredient_missing_cost_unit", { ingredientId: mixLine.ingredientId })
        }
 
        if (ingredient.costUnit.unitType !== "weight") {
            throw new AppError(422, "errors.ingredient_cost_unit_type_mismatch", {
                ingredientId: mixLine.ingredientId,
                unitType: ingredient.costUnit.unitType
            })
        }

        const costUnitBaseFactor = toDecimal(ingredient.costUnit.baseFactor)
        const gramsPerUnit = percentage.dividedBy(100).times(netWeight)
        const quantityPerUnitDecimal = gramsPerUnit.dividedBy(costUnitBaseFactor)
        const lineTotal = roundMoney(unitCost.times(quantityPerUnitDecimal).times(totalUnitsDecimal))

        return {
            ingredientId: mixLine.ingredientId,
            displayName: pickTranslatedName(ingredient?.displayName ?? "", ingredient?.translations, language),
            unitCost: unitCost.toNumber(),
            quantityPerUnit: quantityPerUnitDecimal.toDecimalPlaces(6).toNumber(),
            totalUnits,
            lineTotal
        }
    })

    if (percentageTotal.minus(100).abs().greaterThan(MIX_PERCENTAGE_TOLERANCE)) {
        throw new AppError(422, "errors.mix_percentage_must_total_100", { percentageTotal: percentageTotal.toDecimalPlaces(2).toNumber() })
    }

    return rawMaterials
}

async function calculateQuote(input: CalculateQuoteInput, language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE): Promise<QuoteCalculation> {
    const variant = await ProductVariant.findOne({
        where: { id: input.productVariantId, isActive: true },
        include: [
            {
                model: Product,
                as: "parentProduct",
                include: [
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
                            },
                            { model: Unit, as: "quantityUnit" }
                        ]
                    },
                    { model: ProductTranslation, as: "translations" }
                ]
            },
            { model: Presentation, as: "sizePresentation" },
            { model: Packaging, as: "usedIntermediatePackaging" },
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
            }
        ]
    })
    if (!variant) throw new NotFoundError("ProductVariant", input.productVariantId)

    // "Palet" = cajas por palet × bolsas por caja (2026-09-12) -- reemplaza el viejo input manual
    // único unitsPerPallet (bolsas por palet, escrito a mano por el admin sin ayuda). Ambos
    // factores son obligatorios a nivel de schema (ver productVariant.schema.ts) precisamente
    // porque alimentan esta multiplicación -- ninguno puede faltar en silencio (mismo criterio
    // que el resto de "campos críticos opcionales que corrompen el cálculo", ver memoria del
    // proyecto). bagsPerPallet nunca se guarda como columna propia: se deriva acá, una sola vez,
    // y de ahí en adelante el motor lo usa exactamente como usaba el viejo unitsPerPallet.
    if (!variant.boxesPerPallet || variant.boxesPerPallet <= 0 || !variant.bagsPerBox || variant.bagsPerBox <= 0) {
        throw new AppError(422, "errors.pallet_not_configured")
    }
    const bagsPerPallet = variant.boxesPerPallet * variant.bagsPerBox

    // Guarda de negocio (2026-09-11, a pedido explícito del usuario): un variant con CERO
    // materiales de empaque individual configurados NO debe cotizarse -- sin esta guarda,
    // (variant.unitMaterials ?? []).map(...) más abajo simplemente recorre un arreglo vacío y
    // unitPackagingCost sale en $0 en silencio, exactamente la misma clase de bug que el barrido
    // histórico de "campos críticos opcionales que corrompen el cálculo en silencio" (ver
    // memoria del proyecto: costUnitId, ProductVariantPalletMaterial.quantityValue, etc.) --
    // salvo que acá no hay ningún campo de schema que se pueda volver "requerido": el join puede
    // estar simplemente vacío (0 filas), el ORM nunca "falla" al traer cero resultados, así que
    // hay que chequear la longitud explícito. Mismo criterio (422 + AppError) que
    // pallet_not_configured arriba.
    if ((variant.unitMaterials ?? []).length === 0) {
        throw new AppError(422, "errors.unit_materials_not_configured")
    }

    // Misma guarda, mismo motivo, para el otro join de N filas de la variante: un variant con
    // CERO materiales de paletización configurados no debe cotizarse -- sin esto,
    // (variant.palletMaterials ?? []).map(...) más abajo recorre un arreglo vacío y
    // palletMaterialCost sale en $0 en silencio (2026-09-11, mismo hallazgo que unitMaterials
    // arriba, ver memoria del proyecto).
    if ((variant.palletMaterials ?? []).length === 0) {
        throw new AppError(422, "errors.pallet_materials_not_configured")
    }

    // Transporte "apagado" temporalmente (2026-09-10): el cotizador del cliente ya no pide
    // destino (ver quoteCalculatorForm.component.tsx, prop showDestination), así que
    // input.destinationId puede no llegar. Si no llega, se salta la consulta y el transporte
    // queda en $0 más abajo -- NO se lanza error por "falta destino". Si SÍ llega (el admin, en
    // su cotizador interno, sigue pudiendo mandarlo), se sigue validando que exista, igual que
    // antes: un id inválido sigue siendo un error real, solo la ausencia total del campo dejó
    // de serlo.
    const destination = input.destinationId
        ? await Destination.findOne({ where: { id: input.destinationId, isActive: true } })
        : null
    if (input.destinationId && !destination) throw new NotFoundError("Destination", input.destinationId)

    const requestedPallets = input.requestedPallets
    const totalUnits = requestedPallets * bagsPerPallet

    const rawMaterials: RawMaterialLine[] = variant.parentProduct?.isCustomizable
        ? buildCustomizableRawMaterials(
              variant.parentProduct.productIngredients ?? [],
              input.ingredientMix,
              Number(variant.sizePresentation?.netWeightGrams ?? 0),
              totalUnits,
              language
          )
        : buildFixedRecipeRawMaterials(variant.parentProduct?.productIngredients ?? [], totalUnits, language)
    const rawMaterialCost = sumMoney(rawMaterials.map(line => line.lineTotal))

    // Empaque unitario = SUMA sobre unitMaterials (bolsa + etiqueta + tapa..., receta-style,
    // reemplaza el viejo FK único usedPackaging) -- cada línea es unitCost * quantityPerUnit *
    // totalUnits, mismo criterio de redondeo por línea (MONEY_DECIMALS) que el resto del motor.
    const unitMaterials: UnitMaterialLine[] = (variant.unitMaterials ?? []).map(unitMaterial => {
        const unitCost = toDecimal(unitMaterial.usedUnitMaterial?.unitCost ?? 0)
        const quantityPerUnit = toDecimal(unitMaterial.quantityPerUnit ?? 1)
        const lineTotal = roundMoney(unitCost.times(quantityPerUnit).times(totalUnits))
        return {
            packagingId: unitMaterial.packagingId,
            displayName: unitMaterial.usedUnitMaterial?.displayName ?? "",
            unitCost: unitCost.toNumber(),
            quantityPerUnit: quantityPerUnit.toNumber(),
            totalUnits,
            lineTotal
        }
    })
    const unitPackagingCost = sumMoney(unitMaterials.map(line => line.lineTotal))

    const intermediatePackaging: IntermediatePackagingLine | null = variant.usedIntermediatePackaging
        ? (() => {
              if (!variant.unitsPerIntermediatePackage || variant.unitsPerIntermediatePackage <= 0) {
                  throw new AppError(422, "errors.intermediate_packaging_missing_units")
              }
              const unitCost = toDecimal(variant.usedIntermediatePackaging.unitCost ?? 0)
              const packagesNeeded = Math.ceil(totalUnits / variant.unitsPerIntermediatePackage)
              return {
                  packagingId: variant.usedIntermediatePackaging.id,
                  displayName: variant.usedIntermediatePackaging.displayName,
                  unitCost: unitCost.toNumber(),
                  unitsPerPackage: variant.unitsPerIntermediatePackage,
                  totalUnits,
                  packagesNeeded,
                  lineTotal: roundMoney(unitCost.times(packagesNeeded))
              }
          })()
        : null
    const intermediatePackagingCost = intermediatePackaging?.lineTotal ?? 0

    // "Costos adicionales" (energía, mano de obra indirecta, análisis de laboratorio, almacenaje,
    // mantenimiento) -- se aplican sobre el peso TOTAL de materia prima de la cotización completa
    // (todas las unidades, sin distinguir tipo de ingrediente). Solo se consultan los activos con
    // calculationType "per_weight": "percentage" queda definido en el catálogo como placeholder a
    // futuro (contingencia 2%) pero SIN ninguna lógica implementada todavía -- se excluye acá a
    // propósito, no se calcula ni en $0 ni de ninguna otra forma.
    const activeProcessingCosts = await ProcessingCost.findAll({
        where: { isActive: true, calculationType: "per_weight" },
        include: [{ model: ProcessingCostTranslation, as: "translations" }]
    })

    // Defensa en profundidad: no confiar SOLO en el filtro WHERE de la query de arriba -- se
    // vuelve a validar calculationType acá, en código, antes de calcular. Mismo principio que el
    // resto de calculateQuote (ver ingredient_cost_unit_type_mismatch,
    // product_ingredient_quantity_unit_type_mismatch): un dato crítico para el cálculo de dinero
    // nunca se confía a un solo punto de validación. Si el WHERE de arriba alguna vez se afloja
    // (ej. un futuro refactor que solo filtre por isActive), esta línea sigue evitando que una
    // fila "percentage" (sin lógica implementada todavía) se cuele y se multiplique como si fuera
    // "per_weight".
    const perWeightProcessingCosts = activeProcessingCosts.filter(processingCost => processingCost.calculationType === "per_weight")

    let processingCosts: ProcessingCostLine[] = []
    if (perWeightProcessingCosts.length > 0) {
        // El peso de una unidad es el peso neto de SU presentación (Presentation.netWeightGrams)
        // -- misma fuente que ya usa la receta personalizable para derivar % -> gramos, reusada
        // acá también para receta fija. Se prefirió a "sumar la cantidad de cada línea de
        // materia prima" porque esa suma no está garantizada a coincidir con el peso neto
        // declarado (nada en el catálogo lo obliga), y no todo ingrediente de una receta fija
        // está necesariamente costeado en una unidad de peso (ver ProductIngredient.quantityUnit)
        // -- netWeightGrams es la única fuente de "peso total" que es siempre inequívoca para
        // AMBOS tipos de receta.
        const netWeightGrams = Number(variant.sizePresentation?.netWeightGrams ?? 0)
        if (netWeightGrams <= 0) {
            throw new AppError(422, "errors.presentation_missing_net_weight")
        }

        const totalWeightGrams = toDecimal(netWeightGrams).times(totalUnits)
        const totalWeightPounds = totalWeightGrams.dividedBy(GRAMS_PER_POUND)

        processingCosts = perWeightProcessingCosts.map(processingCost => {
            const value = toDecimal(processingCost.value)
            const lineTotal = roundMoney(value.times(totalWeightPounds))
            return {
                processingCostId: processingCost.id,
                displayName: pickTranslatedName(processingCost.displayName, processingCost.translations, language),
                value: value.toNumber(),
                totalWeightPounds: totalWeightPounds.toDecimalPlaces(6).toNumber(),
                lineTotal
            }
        })
    }
    const processingCostTotal = sumMoney(processingCosts.map(line => line.lineTotal))

    const palletMaterials: PalletMaterialLine[] = (variant.palletMaterials ?? []).map(palletMaterial => {
        const unitCost = toDecimal(palletMaterial.usedPalletMaterial?.unitCost ?? 0)
        const quantityPerPallet = toDecimal(palletMaterial.quantityValue ?? 0)
        const lineTotal = roundMoney(unitCost.times(quantityPerPallet).times(requestedPallets))
        return {
            packagingId: palletMaterial.packagingId,
            displayName: palletMaterial.usedPalletMaterial?.displayName ?? "",
            unitCost: unitCost.toNumber(),
            quantityPerPallet: quantityPerPallet.toNumber(),
            requestedPallets,
            lineTotal
        }
    })
    const palletMaterialCost = sumMoney(palletMaterials.map(line => line.lineTotal))

    // Costos adicionales de tipo "percentage" (ej. "Imprevistos" 2%) -- se aplican AL FINAL, sobre
    // el subtotal YA ESCALADO de todo el producto (materia prima + costos por peso + empaque
    // unitario + empaque intermedio + materiales de palet). El ÚNICO costo que queda FUERA de esa
    // base es el transporte -- se suma después, nunca dentro. El ajuste manual legacy
    // (adjustmentCost / Product.additionalCostPerUnit) tampoco entra a la base ni se ve afectado
    // por este cambio: sigue siendo una línea aparte, exactamente como antes de esta feature
    // (decisión explícita confirmada con el usuario, no una omisión).
    //
    // Query separada de la de "per_weight" arriba a propósito -- no se toca el WHERE ni el
    // comportamiento ya probado de esa rama; esta es una rama nueva, en paralelo, con su propia
    // defensa en profundidad (mismo criterio: no confiar solo en el filtro WHERE).
    const activePercentageCosts = await ProcessingCost.findAll({
        where: { isActive: true, calculationType: "percentage" },
        include: [{ model: ProcessingCostTranslation, as: "translations" }]
    })
    const percentageOnlyCosts = activePercentageCosts.filter(processingCost => processingCost.calculationType === "percentage")

    // Si algún día existen varias filas "percentage" activas a la vez, cada una se aplica al MISMO
    // subtotal base y se SUMAN entre sí (no se componen/encadenan) -- ej. Imprevistos 2% +
    // Utilidad 5% sobre el mismo subtotal de Q1000 = Q20 + Q50 = Q70, no Q1000*1.02*1.05-Q1000.
    // Decisión de negocio confirmada explícitamente con el usuario para este caso.
    const percentageBase = sumMoney([rawMaterialCost, processingCostTotal, unitPackagingCost, intermediatePackagingCost, palletMaterialCost])
    const percentageBaseDecimal = toDecimal(percentageBase)

    const percentageCosts: PercentageCostLine[] = percentageOnlyCosts.map(processingCost => {
        const value = toDecimal(processingCost.value)
        const lineTotal = roundMoney(percentageBaseDecimal.times(value).dividedBy(100))
        return {
            processingCostId: processingCost.id,
            displayName: pickTranslatedName(processingCost.displayName, processingCost.translations, language),
            value: value.toNumber(),
            baseAmount: percentageBase,
            lineTotal
        }
    })
    const percentageCostTotal = sumMoney(percentageCosts.map(line => line.lineTotal))

    // Sin destino -> transporte en $0, sin tocar el motor de cálculo de nada más (ver comentario
    // de arriba). displayName traducido a mano (no viene de un catálogo, es un texto fijo para
    // este caso especial) en vez de dejarlo vacío, para que si el admin ve esta línea en su
    // cotizador interno sin elegir destino, se entienda qué significa el $0.
    const transportCost = destination ? roundMoney(toDecimal(destination.baseCost)) : 0
    const transport: TransportLine = destination
        ? { destinationId: destination.id, displayName: destination.displayName, baseCost: transportCost }
        : { destinationId: null, displayName: language === "en" ? "No destination" : "Sin destino", baseCost: 0 }

    const additionalCostPerUnit = toDecimal(variant.parentProduct?.additionalCostPerUnit ?? 0)
    const adjustmentCost = roundMoney(additionalCostPerUnit.times(totalUnits))
    const adjustment: AdjustmentLine | null = additionalCostPerUnit.greaterThan(0)
        ? { unitCost: additionalCostPerUnit.toNumber(), totalUnits, lineTotal: adjustmentCost }
        : null

    const totalCost = sumMoney([
        rawMaterialCost,
        unitPackagingCost,
        intermediatePackagingCost,
        processingCostTotal,
        palletMaterialCost,
        percentageCostTotal,
        transportCost,
        adjustmentCost
    ])

    // "6 und × 976 ml · 385 cajas/palet" (2026-09-13) -- MISMO formato que el selector de SKU del
    // cliente (quoteCalculatorForm.component.tsx::variantLabel, frontend), para que el resultado/
    // PDF/lista de admin lean idéntico a lo que el cliente vio al elegir. No repite el nombre del
    // producto acá: quotedOrderSummary/quotePdfDocument/adminQuote.page.tsx ya anteponen
    // productDisplayName por su cuenta (" {{productDisplayName}} · {{variantLabel}}") -- si el
    // nombre también viniera dentro de variantLabel, se duplicaría en pantalla.
    // boxesPerPallet/bagsPerBox ya están garantizados no-nulos/positivos en este punto -- la
    // guarda "pallet_not_configured" de arriba ya cortó la ejecución si faltaran. Lo único que
    // puede faltar de verdad es sizePresentation (presentationId es opcional en ProductVariant),
    // que se omite en vez de mostrarse como "undefined"/"null".
    //
    // Los textos fijos ("und"/"units", "cajas/palet"/"boxes/pallet") van hardcodeados en
    // español/inglés acá -- mismo patrón ya usado en este archivo para "Sin destino"/"No
    // destination" (calculateQuote recibe `language` como string plano, no `req.t`/i18next). Si
    // alguno cambia, hay que actualizar a mano también
    // frontend/.../shared/i18n/locales/{es,en}/translation.json ->
    // site.quoteRequest.form.variantLabel.* -- mismo criterio de "catálogo espejado a mano" que
    // unitCatalog.ts.
    const unitsPerBoxLabel = language === "en" ? `${variant.bagsPerBox} units` : `${variant.bagsPerBox} und`
    const sizePart = variant.sizePresentation?.displayLabel
        ? `${unitsPerBoxLabel} × ${variant.sizePresentation.displayLabel}`
        : unitsPerBoxLabel
    const boxesPerPalletLabel = language === "en"
        ? `${variant.boxesPerPallet} boxes/pallet`
        : `${variant.boxesPerPallet} cajas/palet`
    const variantLabelParts = [sizePart, boxesPerPalletLabel]

    return {
        productVariantId: variant.id,
        destinationId: destination?.id ?? null,
        productDisplayName: pickTranslatedName(variant.parentProduct?.displayName ?? "", variant.parentProduct?.translations, language),
        // Ya no puede quedar en null (los dos ingredientes de variantLabelParts están
        // garantizados) -- el tipo del campo se deja igual (string | null) porque cotizaciones
        // GUARDADAS antes de este cambio siguen teniendo su valor congelado tal cual se calculó
        // en su momento (puede ser el formato viejo, o incluso null si son muy antiguas) -- este
        // cambio solo afecta cotizaciones NUEVAS, nunca reescribe una fila ya persistida.
        variantLabel: variantLabelParts.join(" · "),
        requestedPallets,
        totalUnits,
        boxesPerPallet: variant.boxesPerPallet,
        rawMaterialCost,
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
            unitMaterials,
            intermediatePackaging,
            processingCosts,
            palletMaterials,
            percentageCosts,
            transport,
            adjustment,
            language
        }
    }
}

interface QuotableVariant {
    id: number
    skuCode: string | null
    boxesPerPallet: number
    bagsPerBox: number
    presentationLabel: string | null
    packagingLabel: string | null
}

interface QuotableIngredientOption {
    ingredientId: number
    displayName: string
    isOrganic: boolean
    minPercentage: number
    maxPercentage: number
}

interface QuotableProduct {
    id: number
    displayName: string
    isOrganic: boolean
    isCustomizable: boolean
    productTypeName: string | null
    imageUrl: string | null
    categoryId: number
    categoryName: string
    categoryImageUrl: string | null
    ingredientPool: QuotableIngredientOption[]
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
                where: { isActive: true, boxesPerPallet: { [Op.not]: null }, bagsPerBox: { [Op.not]: null } },
                include: [
                    { model: Presentation, as: "sizePresentation" },
                    {
                        model: ProductVariantUnitMaterial,
                        as: "unitMaterials",
                        where: { isActive: true },
                        required: false,
                        include: [{ model: Packaging, as: "usedUnitMaterial" }]
                    }
                ]
            },
            { model: ProductType, as: "parentProductType" },
            {
                model: SubCategory,
                as: "parentSubCategory",
                include: [{
                    model: Category,
                    as: "parentCategory",
                    include: [{ model: CategoryTranslation, as: "translations" }]
                }]
            },
            {
                model: ProductIngredient,
                as: "productIngredients",
                required: false,
                where: { isActive: true },
                include: [{
                    model: Ingredient,
                    as: "usedIngredient",
                    include: [{ model: IngredientTranslation, as: "translations" }]
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
            productTypeName: plain.parentProductType?.displayName ?? null,
            imageUrl: plain.imageUrl ?? null,
            categoryId: category?.id ?? 0,
            categoryName: pickTranslatedName(category?.displayName ?? "", category?.translations, language),
            categoryImageUrl: category?.imageUrl ?? null,
            ingredientPool: plain.isCustomizable
                ? (plain.productIngredients ?? []).map((productIngredient: ProductIngredient) => ({
                      ingredientId: productIngredient.ingredientId,
                      displayName: pickTranslatedName(productIngredient.usedIngredient?.displayName ?? "", productIngredient.usedIngredient?.translations, language),
                      isOrganic: productIngredient.usedIngredient?.isOrganic ?? false,
                      minPercentage: productIngredient.minPercentage !== null && productIngredient.minPercentage !== undefined
                          ? Number(productIngredient.minPercentage)
                          : 0,
                      maxPercentage: productIngredient.maxPercentage !== null && productIngredient.maxPercentage !== undefined
                          ? Number(productIngredient.maxPercentage)
                          : 100
                  }))
                : [],
            variants: (plain.productVariants ?? []).map((variant: ProductVariant) => ({
                id: variant.id,
                skuCode: variant.skuCode ?? null,
                boxesPerPallet: variant.boxesPerPallet as number,
                bagsPerBox: variant.bagsPerBox as number,
                presentationLabel: variant.sizePresentation?.displayLabel ?? null,
                packagingLabel:
                    (variant.unitMaterials ?? [])
                        .map(unitMaterial => unitMaterial.usedUnitMaterial?.displayName)
                        .filter(Boolean)
                        .join(" + ") || null
            }))
        }
    })
}

async function listQuoteDestinations(): Promise<Destination[]> {
    return Destination.findAll({ where: { isActive: true }, order: [["displayName", "ASC"]] })
}


async function saveQuote(customerId: number, input: SaveQuoteInput, language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE): Promise<QuoteCalculation & { id: number; createdAt: Date; leadId: number }> {
    const calculation = await calculateQuote(input, language)

    // Todo cliente que cotiza registra/reusa un Lead (prospecto) -- ver
    // leadService.findOrCreateLeadForQuote para la regla de creación-o-reuso (por email). Nunca
    // se confía en que el frontend ya haya resuelto esto: input.leadContact viaja crudo (validado
    // por saveQuoteSchema, ver quote.schema.ts) y se resuelve acá, del lado del servidor.
    const lead = await leadService.findOrCreateLeadForQuote(input.leadContact)

    const quote = await Quote.create({
        customerId,
        leadId: lead.id,
        productVariantId: calculation.productVariantId,
        destinationId: calculation.destinationId,
        productDisplayName: calculation.productDisplayName,
        variantLabel: calculation.variantLabel,
        requestedPallets: calculation.requestedPallets,
        totalUnits: calculation.totalUnits,
        rawMaterialCost: calculation.rawMaterialCost,
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

    return {
        ...calculation,
        id: quote.id,
        createdAt: quote.get("createdAt") as Date,
        leadId: lead.id
    }
}


async function listAllQuotes(): Promise<Quote[]> {
    return Quote.findAll({
        include: [
            { model: Customer, as: "quotingCustomer", attributes: ["id", "name", "companyName", "email"] },
            // Prospecto vinculado (2026-09-13, ver Quote.leadId) -- required:false porque
            // cotizaciones guardadas ANTES de este cambio no tienen leadId, y no deben
            // desaparecer del listado por eso.
            { model: Lead, as: "quotedLead", required: false, attributes: ["id", "fullName", "companyName", "email"] }
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
