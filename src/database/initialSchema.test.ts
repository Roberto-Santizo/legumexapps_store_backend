import { Sequelize } from "sequelize-typescript"
import { databaseModels } from "./models"
import { schemaChecks, schemaFunctions, schemaTriggers } from "./schemaExtras"
const metadata=new Sequelize({dialect:'postgres',logging:false,models:databaseModels})
afterAll(()=>metadata.close())
test("the sole current schema contract has 49 models, 16 checks, 5 functions and 7 triggers",()=>{
    expect(databaseModels).toHaveLength(49)
    expect(new Set(metadata.modelManager.models.map(model=>model.tableName)).size).toBe(49)
    expect(schemaChecks).toHaveLength(16)
    expect(schemaFunctions).toHaveLength(5)
    expect(schemaTriggers).toHaveLength(7)
    for(const trigger of schemaTriggers) expect(schemaFunctions.some(fn=>fn.name===trigger.functionName)).toBe(true)
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
