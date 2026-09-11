import { createProcessingCostSchema, updateProcessingCostSchema } from "./processingCost.schema"

// Mismo estilo que quote.schema.test.ts: safeParse(...).success, sin mockear nada -- estos son
// tests puros de forma de dato, no de lógica de negocio (esa vive en quote.service.test.ts).

function validCreateInput() {
    return {
        displayName: "Energía",
        value: 0.15,
        calculationType: "per_weight" as const,
    }
}

describe("createProcessingCostSchema", () => {
    it("acepta un input válido mínimo", () => {
        expect(createProcessingCostSchema.safeParse(validCreateInput()).success).toBe(true)
    })

    it("acepta translations.en.displayName opcional", () => {
        const result = createProcessingCostSchema.safeParse({
            ...validCreateInput(),
            translations: { en: { displayName: "Energy" } },
        })
        expect(result.success).toBe(true)
    })

    describe("displayName", () => {
        it("rechaza si falta displayName", () => {
            const { displayName: _displayName, ...rest } = validCreateInput()
            expect(createProcessingCostSchema.safeParse(rest).success).toBe(false)
        })

        it("rechaza displayName vacío", () => {
            expect(createProcessingCostSchema.safeParse({ ...validCreateInput(), displayName: "" }).success).toBe(false)
        })

        it("rechaza displayName de solo espacios en blanco (trim lo deja vacío)", () => {
            expect(createProcessingCostSchema.safeParse({ ...validCreateInput(), displayName: "   " }).success).toBe(false)
        })
    })

    // "value" es el campo que alimenta directamente el cálculo (quote.service.ts multiplica esto
    // por el peso total en libras) -- este es exactamente el tipo de campo que el bug histórico
    // "costos en millones" (ver context.md) demuestra que NO puede quedar con un fallback en
    // silencio: debe rechazarse explícito si no es un número válido y no negativo.
    describe("value -- campo crítico para el cálculo, no puede colar un valor inválido en silencio", () => {
        it("rechaza un value negativo", () => {
            expect(createProcessingCostSchema.safeParse({ ...validCreateInput(), value: -0.01 }).success).toBe(false)
        })

        it("acepta 0 como value -- mismo criterio que costPerUnit/baseCost/unitCost en el resto del repo (.nonnegative(), no .positive()); un costo adicional en Q0 es una fila desactivable, no un error de captura", () => {
            expect(createProcessingCostSchema.safeParse({ ...validCreateInput(), value: 0 }).success).toBe(true)
        })

        it("rechaza value null", () => {
            expect(createProcessingCostSchema.safeParse({ ...validCreateInput(), value: null }).success).toBe(false)
        })

        it("rechaza si falta value por completo", () => {
            const { value: _value, ...rest } = validCreateInput()
            expect(createProcessingCostSchema.safeParse(rest).success).toBe(false)
        })

        it("rechaza value como texto (\"0.15\") -- debe ser number, no string, a nivel de schema", () => {
            expect(createProcessingCostSchema.safeParse({ ...validCreateInput(), value: "0.15" }).success).toBe(false)
        })

        it("rechaza value = NaN", () => {
            expect(createProcessingCostSchema.safeParse({ ...validCreateInput(), value: Number.NaN }).success).toBe(false)
        })

        it("rechaza value = Infinity (no es un costo real)", () => {
            expect(createProcessingCostSchema.safeParse({ ...validCreateInput(), value: Number.POSITIVE_INFINITY }).success).toBe(false)
        })
    })

    describe("calculationType -- enum cerrado, ambos valores ('per_weight' y 'percentage') tienen lógica implementada en quote.service.ts", () => {
        it("acepta 'per_weight'", () => {
            expect(createProcessingCostSchema.safeParse({ ...validCreateInput(), calculationType: "per_weight" }).success).toBe(true)
        })

        it("acepta 'percentage'", () => {
            expect(createProcessingCostSchema.safeParse({ ...validCreateInput(), calculationType: "percentage" }).success).toBe(true)
        })

        it("rechaza un calculationType desconocido", () => {
            expect(createProcessingCostSchema.safeParse({ ...validCreateInput(), calculationType: "per_hour" }).success).toBe(false)
        })

        it("rechaza si falta calculationType", () => {
            const { calculationType: _calculationType, ...rest } = validCreateInput()
            expect(createProcessingCostSchema.safeParse(rest).success).toBe(false)
        })
    })

    // Tope de cordura SOLO para calculationType "percentage" (ver MAX_PERCENTAGE_VALUE en
    // processingCost.schema.ts) -- "value" es un campo compartido con "per_weight" (Q/libra, sin
    // techo natural), así que el límite es condicional al tipo, no del campo en general.
    describe("value -- tope de 100 SOLO aplica a calculationType 'percentage', per_weight no tiene techo", () => {
        it("rechaza un value de 'percentage' por encima de 100", () => {
            const result = createProcessingCostSchema.safeParse({ ...validCreateInput(), calculationType: "percentage", value: 100.01 })
            expect(result.success).toBe(false)
        })

        it("acepta un value de 'percentage' de exactamente 100 (borde inclusivo)", () => {
            const result = createProcessingCostSchema.safeParse({ ...validCreateInput(), calculationType: "percentage", value: 100 })
            expect(result.success).toBe(true)
        })

        it("acepta un value de 'percentage' típico (2, para \"Imprevistos\")", () => {
            const result = createProcessingCostSchema.safeParse({ ...validCreateInput(), calculationType: "percentage", value: 2 })
            expect(result.success).toBe(true)
        })

        it("un value de 'per_weight' por encima de 100 SÍ se acepta -- el tope no aplica a ese tipo (es un monto en Q/libra, no un porcentaje)", () => {
            const result = createProcessingCostSchema.safeParse({ ...validCreateInput(), calculationType: "per_weight", value: 500 })
            expect(result.success).toBe(true)
        })

        it("aplica el mismo tope también en el update (partial + refine)", () => {
            const result = updateProcessingCostSchema.safeParse({ value: 150, calculationType: "percentage" })
            expect(result.success).toBe(false)
        })
    })
})

describe("updateProcessingCostSchema -- value/calculationType deben seguir siendo requeridos también al editar", () => {
    // Patrón documentado del repo: updateXSchema = createXSchema.partial().extend({ campoCritico:
    // createXSchema.shape.campoCritico }) -- si esto se rompiera (alguien quita el .extend()), un
    // PUT que omita "value" dejaría el costo existente con lo que Sequelize decida no tocar, pero
    // peor aún, un PUT que sí mande otros campos sin querer podría no validar "value" como
    // requerido. Este test falla fuerte si updateProcessingCostSchema alguna vez vuelve a ser un
    // simple .partial() sin el .extend().
    it("rechaza un update que solo trae displayName (sin value ni calculationType)", () => {
        const result = updateProcessingCostSchema.safeParse({ displayName: "Nuevo nombre" })
        expect(result.success).toBe(false)
    })

    it("rechaza un update sin calculationType aunque sí traiga value", () => {
        const result = updateProcessingCostSchema.safeParse({ value: 0.2 })
        expect(result.success).toBe(false)
    })

    it("rechaza un update sin value aunque sí traiga calculationType", () => {
        const result = updateProcessingCostSchema.safeParse({ calculationType: "per_weight" })
        expect(result.success).toBe(false)
    })

    it("acepta un update con solo value + calculationType (displayName es opcional al editar)", () => {
        const result = updateProcessingCostSchema.safeParse({ value: 0.2, calculationType: "per_weight" })
        expect(result.success).toBe(true)
    })

    it("rechaza value negativo también en el update", () => {
        const result = updateProcessingCostSchema.safeParse({ value: -1, calculationType: "per_weight" })
        expect(result.success).toBe(false)
    })
})
