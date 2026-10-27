import { Sequelize } from "sequelize-typescript"
import { databaseModels } from "./models"
import { schemaChecks, schemaFunctions, schemaTriggers } from "./schemaExtras"
const metadata=new Sequelize({dialect:'postgres',logging:false,models:databaseModels})
afterAll(()=>metadata.close())
test("the sole current schema contract has 48 models, 15 checks, 5 functions and 7 triggers",()=>{
    expect(databaseModels).toHaveLength(48)
    expect(new Set(metadata.modelManager.models.map(model=>model.tableName)).size).toBe(48)
    expect(schemaChecks).toHaveLength(15)
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

test("retired option tables, juice administration tables and organic column are absent", () => {
    const tables = metadata.modelManager.models.map(model => model.tableName)
    for (const table of ["customQuoteRawMaterialOptions", "customQuoteIngredientOptions", "customQuotePresentationOptions", "customQuotePackagingOptions", "juiceCostConstants", "juiceClientConstantOverrides"]) expect(tables).not.toContain(table)
    expect(metadata.model("CustomQuote").rawAttributes).not.toHaveProperty("isOrganic")
})
