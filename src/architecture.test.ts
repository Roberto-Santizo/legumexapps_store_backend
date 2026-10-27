import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

// Arquitectura por feature: estas reglas fallan si un cambio reintroduce ciclos entre features o
// coloca archivos fuera de las carpetas estándar. Leer otro feature por sus modelos (acceso a datos)
// está permitido; los modelos se referencian entre sí por las asociaciones de Sequelize.
const src = __dirname
const walk = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : entry.name.endsWith(".ts") ? [path.join(directory, entry.name)] : [])
const relative = (file: string) => path.relative(src, file).split(path.sep).join("/")
const files = walk(src).map(file => ({ file: relative(file), text: fs.readFileSync(file, "utf8") }))
const productionFiles = files.filter(({ file }) => !file.endsWith(".test.ts") && !file.startsWith("shared/test-utils/"))
const featureOf = (file: string) => file.match(/^features\/([^/]+)\//)?.[1]

function imports({ file, text }: { file: string; text: string }): string[] {
    const targets: string[] = []
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node) => {
        let specifier: ts.Node | undefined
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) specifier = node.arguments[0]
        if (specifier && (ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier)) && specifier.text.startsWith(".")) targets.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier.text)))
        ts.forEachChild(node, visit)
    }
    visit(source)
    return targets
}

const FEATURE_FOLDERS = new Set(["models", "schemas", "services", "controllers", "routes", "constants", "utils"])
const SUFFIX: Record<string, RegExp> = {
    models: /\.(model|dbExtras)\.ts$/,
    schemas: /\.schema\.ts$/,
    controllers: /\.controller\.ts$/,
    routes: /\.routes\.ts$/,
}
// accessControl agrupa subfeatures (login, permissions, roles...) con la misma estructura.
const SUBFEATURE_PARENTS = new Set(["accessControl"])

describe("feature-based architecture", () => {
    it("has no cycles between features outside data access through models", () => {
        const graph = new Map<string, Set<string>>()
        for (const entry of productionFiles) {
            const feature = featureOf(entry.file)
            if (!feature) continue
            const edges = graph.get(feature) ?? new Set<string>()
            for (const target of imports(entry)) {
                const targetFeature = featureOf(target)
                if (targetFeature && targetFeature !== feature && !target.includes("/models/")) edges.add(targetFeature)
            }
            graph.set(feature, edges)
        }
        const state = new Map<string, "active" | "done">(), cycles: string[] = []
        const visit = (node: string, trail: string[]) => {
            if (state.get(node) === "done") return
            if (state.get(node) === "active") { cycles.push([...trail.slice(trail.indexOf(node)), node].join(" -> ")); return }
            state.set(node, "active")
            for (const next of graph.get(node) ?? []) visit(next, [...trail, node])
            state.set(node, "done")
        }
        for (const node of graph.keys()) visit(node, [])
        expect(cycles).toEqual([])
    })

    it("keeps shared code and configuration independent of features", () => {
        const offenders = productionFiles
            .filter(entry => /^(shared|config)\//.test(entry.file) && imports(entry).some(target => featureOf(target)))
            .map(entry => entry.file)
        expect(offenders).toEqual([])
    })

    it("places feature files in the standard folders with the expected suffixes", () => {
        const misplaced = files.filter(({ file }) => {
            if (!file.startsWith("features/")) return false
            const parts = file.split("/")
            const folderIndex = SUBFEATURE_PARENTS.has(parts[1]) ? 3 : 2
            if (parts.length !== folderIndex + 2) return true
            const folder = parts[folderIndex], name = parts[folderIndex + 1]
            if (!FEATURE_FOLDERS.has(folder)) return true
            return !name.endsWith(".test.ts") && SUFFIX[folder] !== undefined && !SUFFIX[folder].test(name)
        }).map(entry => entry.file)
        expect(misplaced).toEqual([])
    })

    it("keeps request handling in controllers: routes only wire middlewares and controllers", () => {
        const offenders = productionFiles
            .filter(entry => /^features\/.+\/routes\//.test(entry.file) && imports(entry).some(target => /\/(services|models)\//.test(target)))
            .map(entry => entry.file)
        expect(offenders).toEqual([])
    })

    it("names models in PascalCase and every other feature file in camelCase", () => {
        const offenders = files.filter(({ file }) => file.startsWith("features/")).map(({ file }) => file).filter(file => {
            const name = file.split("/").at(-1)!
            if (file.includes("/models/")) return name.endsWith(".model.ts") && !/^[A-Z][a-zA-Z0-9]*\.model\.ts$/.test(name)
            return !/^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*\.ts$/.test(name)
        })
        expect(offenders).toEqual([])
    })
})


it.each(["import x from './dependency'", "export { x } from './dependency'", "const x = require('./dependency')", "const x = import(`./dependency`)"])("checks dependencies expressed as %s", text => {
    expect(imports({ file: "features/example/services/example.ts", text })).toEqual(["features/example/services/dependency"])
})

it("keeps controllers and schemas independent of transport and persistence implementation", () => {
    const offenders = productionFiles.filter(entry =>
        (/\/controllers\//.test(entry.file) && imports(entry).some(target => /\/(models|routes)\//.test(target))) ||
        (/\/schemas\//.test(entry.file) && imports(entry).some(target => /\/(controllers|routes|services)\//.test(target)))
    ).map(entry => entry.file)
    expect(offenders).toEqual([])
})

 it("keeps inline callbacks out of feature route modules", () => {
    const offenders = productionFiles.filter(entry => {
        if (!/\/routes\//.test(entry.file)) return false
        let found = false
        const visit = (node: ts.Node) => {
            if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) found = true
            ts.forEachChild(node, visit)
        }
        visit(ts.createSourceFile(entry.file, entry.text, ts.ScriptTarget.Latest, true))
        return found
    }).map(entry => entry.file)
    expect(offenders).toEqual([])
})
