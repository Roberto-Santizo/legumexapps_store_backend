import dotenv from "dotenv"
import path from "node:path"
import { parseDbSyncAlter } from "./dbSyncAlter"
import { parseFrontendOrigin } from "./frontendOrigin"
import { parseNodeEnv } from "./nodeEnv"
import { parseServerPort } from "./serverPort"
import { parseDatabaseRolePolicy } from "./databaseRolePolicy"
import { parseQuoteReviewRecipients } from "./quoteReviewRecipients"

if (process.env.NODE_ENV === undefined || process.env.NODE_ENV === "development") dotenv.config({ path: path.resolve(__dirname, ".env"), quiet: true })
const dbSyncAlter = parseDbSyncAlter(process.env.DB_SYNC_ALTER)
const nodeEnv = parseNodeEnv(process.env.NODE_ENV)
const frontendUrl = parseFrontendOrigin(process.env.FRONTEND_URL, nodeEnv)

function getRequiredEnv(key: string): string {
    const value = process.env[key]
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`)
    }
    return value
}

export const env = {
    nodeEnv,
    serverPort: parseServerPort(process.env.PORT, process.env.SERVER_PORT),
    databaseUrl: getRequiredEnv("DATABASE_URL"),
    databaseCaCert: process.env.DATABASE_CA_CERT || undefined,
    databaseRolePolicy: parseDatabaseRolePolicy(process.env.DB_ROLE_POLICY),
    dbSyncAlter,
    jwtSecret: getRequiredEnv("JWT_SECRET"),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
    awsRegion: getRequiredEnv("AWS_REGION"),
    awsAccessKeyId: getRequiredEnv("AWS_ACCESS_KEY_ID"),
    awsSecretAccessKey: getRequiredEnv("AWS_SECRET_ACCESS_KEY"),
    awsS3BucketName: getRequiredEnv("AWS_S3_BUCKET_NAME"),
    frontendUrl,
    microsoftTenantId: getRequiredEnv("MICROSOFT_TENANT_ID"),
    microsoftClientId: getRequiredEnv("MICROSOFT_CLIENT_ID"),
    microsoftClientSecret: getRequiredEnv("MICROSOFT_CLIENT_SECRET"),
    noreplyUser: getRequiredEnv("NOREPLY_USER"),
    quoteReviewRecipients: parseQuoteReviewRecipients(process.env.QUOTE_REVIEW_EMAIL),
} as const
