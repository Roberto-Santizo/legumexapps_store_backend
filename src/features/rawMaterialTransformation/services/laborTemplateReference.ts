import reference from "../constants/tejarLaborReference.json"
import { laborCalculationSchema, saveLaborLineSchema } from "../schemas/laborTemplate.schema"

export function getLaborReference() {
    const calculation = laborCalculationSchema.parse({ ...reference.settings, positions: reference.example.positions })
    return {
        plantName: reference.plantName,
        sources: reference.sources,
        lines: reference.lines.map(line => {
            const parsed = saveLaborLineSchema.parse({
                code: line.code, displayName: line.displayName, plantName: reference.plantName,
                shift: line.shift, isActive: true, expectedVersion: 0,
                positions: line.positions.map(position => ({ code: position.code, jobTitle: position.jobTitle })),
            })
            const { expectedVersion, ...values } = parsed
            return { ...values, revision: expectedVersion }
        }),
        settings: { daysPerYear: calculation.daysPerYear, weeklyHours: calculation.weeklyHours, benefits: calculation.benefits },
        example: { ...reference.example, positions: calculation.positions, calendarMode: "excel_reference" as const },
    }
}
