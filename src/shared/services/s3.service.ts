import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3"
import { randomUUID } from "node:crypto"
import { env } from "../../config/env"

const s3 = new S3Client({
    region: env.awsRegion,
    credentials: {
        accessKeyId: env.awsAccessKeyId,
        secretAccessKey: env.awsSecretAccessKey,
    },
})

const BUCKET_URL_PREFIX = `https://${env.awsS3BucketName}.s3.${env.awsRegion}.amazonaws.com/`

export function getS3Url(key: string): string {
    return `${BUCKET_URL_PREFIX}${key}`
}

export function getKeyFromUrl(url: string): string {
    return url.startsWith(BUCKET_URL_PREFIX) ? url.slice(BUCKET_URL_PREFIX.length) : url
}

export function isBase64Image(value: string): boolean {
    return value.startsWith("data:image/")
}

export async function uploadImage(base64: string, folder: string): Promise<string> {
    const mimeType = /^data:(image\/\w+);base64,/.exec(base64)?.[1] ?? "image/jpeg"
    const extension = mimeType.split("/")[1]
    const clean = base64.replace(/^data:image\/\w+;base64,/, "")
    const buffer = Buffer.from(clean, "base64")
    const key = `${folder}/${Date.now()}-${randomUUID()}.${extension}`

    await s3.send(new PutObjectCommand({
        Bucket: env.awsS3BucketName,
        Key: key,
        Body: buffer,
        ACL: 'public-read',
        ContentType: mimeType,
    }))

    return key
}

export async function deleteImage(key: string): Promise<void> {
    await s3.send(new DeleteObjectCommand({
        Bucket: env.awsS3BucketName,
        Key: key,
    }))
}
