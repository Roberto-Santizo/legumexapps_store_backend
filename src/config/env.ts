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
    frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
    microsoftTenantId: getRequiredEnv("MICROSOFT_TENANT_ID"),
    microsoftClientId: getRequiredEnv("MICROSOFT_CLIENT_ID"),
    microsoftClientSecret: getRequiredEnv("MICROSOFT_CLIENT_SECRET"),
    noreplyUser: getRequiredEnv("NOREPLY_USER"),

    banguatExchangeRateUrl: getHttpsUrlEnv(
        "BANGUAT_EXCHANGE_RATE_URL",
        "https://www.banguat.gob.gt/variables/ws/TipoCambio.asmx/TipoCambioDia"
    ),
    exchangeRateCacheTtlMs: Number(process.env.EXCHANGE_RATE_CACHE_TTL_MS) || 6 * 60 * 60 * 1000,
    exchangeRateFetchTimeoutMs: Number(process.env.EXCHANGE_RATE_FETCH_TIMEOUT_MS) || 5000,
} as const
