// Reproducible offline defaults. Test processes never load the developer's private .env.
// The owned PostgreSQL harness supplies TEST_* URLs separately to opt-in integration suites.
Object.assign(process.env, {
    NODE_ENV: "test", DATABASE_URL: "postgres://synthetic:synthetic@127.0.0.1:1/unused",
    FRONTEND_URL: "http://localhost:5173", DB_SYNC_ALTER: "false", SERVER_PORT: "4000",
    JWT_SECRET: "synthetic-test-secret", JWT_EXPIRES_IN: "8h",
    AWS_REGION: "us-east-1", AWS_ACCESS_KEY_ID: "synthetic", AWS_SECRET_ACCESS_KEY: "synthetic", AWS_S3_BUCKET_NAME: "synthetic",
    MICROSOFT_TENANT_ID: "00000000-0000-0000-0000-000000000001", MICROSOFT_CLIENT_ID: "00000000-0000-0000-0000-000000000002",
    MICROSOFT_CLIENT_SECRET: "synthetic", NOREPLY_USER: "synthetic@example.invalid",
})
delete process.env.DATABASE_CA_CERT
