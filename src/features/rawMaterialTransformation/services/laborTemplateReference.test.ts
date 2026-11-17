import { getLaborReference } from "./laborTemplateReference"

test("preserves all 49 Tejar lines and 713 uniquely identified catalog positions in natural order", () => {
    const reference = getLaborReference()
    expect(reference.lines).toHaveLength(49)
    const positions = reference.lines.flatMap(line => line.positions)
    expect(positions).toHaveLength(713)
    expect(new Set(positions.map(position => position.code)).size).toBe(713)
    for (const line of reference.lines) {
        expect(["AM", "PM"]).toContain(line.shift)
        expect(line.plantName).toBe("Planta 1 / Tejar")
        expect(line.positions.every(position => position.code.startsWith(line.code))).toBe(true)
        expect(line.positions.every(position => !("salaryMonthlyGtq" in position))).toBe(true)
    }
    expect(reference.sources.map(source => source.sheets).flat()).toEqual(["Lineas", "Posiciones", "RECETA", "HOJA TÉCNICA COSTOS", "EJEMPLO PLANTILLA"])
})

test("keeps the 43-position Excel example separate from the 32-position current line", () => {
    const reference = getLaborReference()
    expect(reference.lines.find(line => line.code === "1LNDTA")?.positions).toHaveLength(32)
    expect(reference.example.positions).toHaveLength(43)
    expect(reference.lines.find(line => line.code === "1LNDTB")?.positions).toHaveLength(44)
    expect(reference.lines.find(line => line.code === "1REM3A")?.positions).toHaveLength(72)
})
