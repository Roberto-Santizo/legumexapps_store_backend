import dotenv from "dotenv"
import path from "node:path"

dotenv.config({ path: path.resolve(__dirname, ".env") })

function getRequiredEnv(key: string): string {
    const value = process.env[key]
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`)
    }
    return value
}

// Fuerza que una URL de servicio externo use HTTPS -- pensado para integraciones como Banguat
// (shared/services/exchangeRate.service.ts), donde el resultado alimenta cálculos de dinero
// reales. Falla rápido al arrancar el proceso si alguien pone por error una URL http:// (o
// cualquier otro esquema) en el .env, en vez de degradar en silencio a una conexión sin cifrar.
function getHttpsUrlEnv(key: string, defaultValue: string): string {
    const value = process.env[key] ?? defaultValue
    if (!value.startsWith("https://")) {
        throw new Error(`${key} debe ser una URL https:// (recibido: ${value})`)
    }
    return value
}

export const env = {
    nodeEnv: process.env.NODE_ENV ?? "development",
    serverPort: Number(process.env.SERVER_PORT) || 3000,
    databaseUrl: getRequiredEnv("DATABASE_URL"),
    dbSyncAlter: process.env.DB_SYNC_ALTER === "true",
    jwtSecret: getRequiredEnv("JWT_SECRET"),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
    seedAdminUsername: process.env.SEED_ADMIN_USERNAME,
    seedAdminPassword: process.env.SEED_ADMIN_PASSWORD,
    awsRegion: getRequiredEnv("AWS_REGION"),
    awsAccessKeyId: getRequiredEnv("AWS_ACCESS_KEY_ID"),
    awsSecretAccessKey: getRequiredEnv("AWS_SECRET_ACCESS_KEY"),
    awsS3BucketName: getRequiredEnv("AWS_S3_BUCKET_NAME"),
    // CORS: origen del frontend. Por ahora solo dev (Vite) -- cuando haya dominio de
    // producción, se agrega vía esta misma variable de entorno, sin tocar server.ts.
    frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
    // App registrada en Azure AD (client credentials flow) para enviar correo como
    // noreply@legumex.net vía Microsoft Graph -- ver shared/services/email.service.ts. No hay
    // buzón/contraseña de usuario involucrado, solo permiso de aplicación Mail.Send sobre ese
    // buzón específico.
    microsoftTenantId: getRequiredEnv("MICROSOFT_TENANT_ID"),
    microsoftClientId: getRequiredEnv("MICROSOFT_CLIENT_ID"),
    microsoftClientSecret: getRequiredEnv("MICROSOFT_CLIENT_SECRET"),
    noreplyUser: getRequiredEnv("NOREPLY_USER"),
    // Tipo de cambio USD->GTQ (Banco de Guatemala) -- ver shared/services/exchangeRate.service.ts
    // para el diseño completo (por qué no se usa un parser XML completo, validación de rango,
    // cache single-flight, etc.). URL forzada a HTTPS por getHttpsUrlEnv -- nunca debe degradar a
    // una conexión sin cifrar contra un servicio de terceros cuyo resultado multiplica dinero real.
    banguatExchangeRateUrl: getHttpsUrlEnv(
        "BANGUAT_EXCHANGE_RATE_URL",
        "https://www.banguat.gob.gt/variables/ws/TipoCambio.asmx/TipoCambioDia"
    ),
    // Cuánto tiempo se sirve el tipo de cambio desde cache antes de intentar refrescarlo contra
    // Banguat (default 6 horas -- este dato no cambia varias veces al día en la práctica).
    exchangeRateCacheTtlMs: Number(process.env.EXCHANGE_RATE_CACHE_TTL_MS) || 6 * 60 * 60 * 1000,
    // Timeout del fetch a Banguat -- un servicio externo colgado nunca debe poder colgar el
    // cálculo de una cotización (ver getUsdToGtqRate, siempre best-effort con fallback a cache).
    exchangeRateFetchTimeoutMs: Number(process.env.EXCHANGE_RATE_FETCH_TIMEOUT_MS) || 5000,
} as const
