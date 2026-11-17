import { Sequelize } from "sequelize-typescript"
import { databaseModels } from "./models"
import { schemaChecks, schemaFunctions, schemaTriggers } from "./schemaExtras"
import { PERMISSIONS } from "../features/accessControl/permissions/constants/accessControlPolicy"
const metadata=new Sequelize({dialect:'postgres',logging:false,models:databaseModels})
afterAll(()=>metadata.close())
test("the sole current schema contract has 51 models, 16 checks, 5 functions and 7 triggers",()=>{
    expect(databaseModels).toHaveLength(51)
    expect(new Set(metadata.modelManager.models.map(model=>model.tableName)).size).toBe(51)
    expect(schemaChecks).toHaveLength(16)
    expect(schemaFunctions).toHaveLength(5)
    expect(schemaTriggers).toHaveLength(7)
    for(const trigger of schemaTriggers) expect(schemaFunctions.some(fn=>fn.name===trigger.functionName)).toBe(true)
})

test("labor templates register their own GTQ catalog and history without changing PCS or quotation models", () => {
    for (const name of ["LaborTemplateLine", "LaborTemplate", "LaborTemplatePosition", "LaborTemplateRevision"]) expect(metadata.model(name)).toBeDefined()
    expect(metadata.model("LaborTemplate").rawAttributes.lineId.references).toMatchObject({ model: "laborTemplateLines", key: "id" })
    expect(metadata.model("LaborTemplatePosition").options.indexes).toEqual(expect.arrayContaining([expect.objectContaining({ unique: true, fields: ["templateId", "code"] })]))
    expect(metadata.model("LaborTemplateRevision").options.indexes).toEqual(expect.arrayContaining([expect.objectContaining({ unique: true, fields: ["templateId", "revision"] })]))
    expect(String(metadata.model("LaborTemplateRevision").rawAttributes.snapshot.type)).toBe("JSONB")
    expect(metadata.model("RawMaterialTransformationCost").rawAttributes).not.toHaveProperty("laborTemplateId")
    expect(metadata.model("RawMaterial").rawAttributes).not.toHaveProperty("laborTemplateId")
})

test("retired prospect and landing image modules cannot recreate their tables or permissions", () => {
    expect(metadata.modelManager.models.map(model => model.tableName)).not.toContain("leads")
    expect(metadata.modelManager.models.map(model => model.tableName)).not.toContain("site_images")
    expect(PERMISSIONS).toHaveLength(87)
    expect(PERMISSIONS.some(permission => permission.name.startsWith("leads:"))).toBe(false)
    expect(PERMISSIONS.some(permission => permission.name === "siteContent:edit")).toBe(false)
    for (const name of ["Client", "Salesperson", "Quote", "CustomQuote", "QuoteOrderReview"]) expect(metadata.model(name)).toBeDefined()
})
test("current juice and USD models exclude retired economic fields",()=>{
    const attrs=(name:string)=>metadata.model(name).rawAttributes
    expect(attrs('Juice')).not.toHaveProperty('pricePerPound')
    expect(attrs('JuicePresentation')).not.toHaveProperty('marginPerCase')
    expect(attrs('Product')).toHaveProperty('isOrganic')
    expect(attrs('ProductVariant')).toHaveProperty('bagsPerBox.field','unitsPerBox')
})

test("volume pricing DECIMAL attributes serialize as nullable numbers without connecting", () => {
    const material = metadata.model("Packaging").build({ lowVolumeMaximumQuantity: "5000.00", mediumVolumeMaximumQuantity: "25000.00", mediumVolumeMinimumQuantity: null, mediumVolumeUnitCost: "0.123456789012", highVolumeMinimumQuantity: null, highVolumeUnitCost: null })
    expect(material.toJSON()).toMatchObject({ lowVolumeMaximumQuantity: 5000, mediumVolumeMaximumQuantity: 25000, mediumVolumeMinimumQuantity: null, mediumVolumeUnitCost: 0.123456789012, highVolumeMinimumQuantity: null, highVolumeUnitCost: null })
})

test("fourth-tier limits and twelve-decimal costs serialize numerically without connecting", () => {
    const material = metadata.model("Packaging").build({ highVolumeMaximumQuantity: "15000.00", fourthVolumeMaximumQuantity: "20000.00", fourthVolumeUnitCost: "0.123456789012" })
    expect(material.toJSON()).toMatchObject({ highVolumeMaximumQuantity: 15000, fourthVolumeMaximumQuantity: 20000, fourthVolumeUnitCost: 0.123456789012 })
    const empty = metadata.model("Packaging").build({ highVolumeMaximumQuantity: null, fourthVolumeMaximumQuantity: null, fourthVolumeUnitCost: null })
    expect(empty.toJSON()).toMatchObject({ highVolumeMaximumQuantity: null, fourthVolumeMaximumQuantity: null, fourthVolumeUnitCost: null })
})

test("retired option tables, juice administration tables and organic column are absent", () => {
    const tables = metadata.modelManager.models.map(model => model.tableName)
    for (const table of ["customQuoteRawMaterialOptions", "customQuoteIngredientOptions", "customQuotePresentationOptions", "customQuotePackagingOptions", "juiceCostConstants", "juiceClientConstantOverrides"]) expect(tables).not.toContain(table)
    expect(metadata.model("CustomQuote").rawAttributes).not.toHaveProperty("isOrganic")
})
