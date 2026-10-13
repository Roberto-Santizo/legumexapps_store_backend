import fs from "node:fs"
import path from "node:path"

export function ownedPostgresEnabled(): boolean {
    if (!process.env.TEST_DATABASE_URL) return false
    if (process.env.LEGUMEX_ISOLATED_POSTGRES !== "1" || !process.env.LEGUMEX_TEST_CLUSTER_DIR) {
        throw new Error("PostgreSQL integration requires scripts/test-postgres.cjs; external TEST_DATABASE_URL is not authorized")
    }
    return true
}

export async function verifyOwnedPostgres(client: { query(sql: string): Promise<{ rows: any[] }> }): Promise<void> {
    const url = new URL(process.env.TEST_DATABASE_URL!)
    const id = url.username.match(/^test_owner_([a-f0-9]{32})$/)?.[1]
    if (!id || url.hostname !== "127.0.0.1" || url.pathname !== `/legumex_test_${id}` || url.search !== "?sslmode=disable") throw new Error("Owned PostgreSQL URL proof failed")
    const directory = fs.realpathSync(process.env.LEGUMEX_TEST_CLUSTER_DIR!)
    const identity = (await client.query("SELECT current_user,current_database(),current_setting('data_directory') AS data_directory,current_setting('port') AS port")).rows[0]
    const pid = fs.readFileSync(path.join(directory, "postmaster.pid"), "utf8").split(/\r?\n/)
    if (!identity || identity.current_user !== url.username || identity.current_database !== url.pathname.slice(1)
        || fs.realpathSync(identity.data_directory) !== directory || fs.realpathSync(pid[1]) !== directory
        || Number(identity.port) !== Number(url.port) || Number(pid[3]) !== Number(url.port)) throw new Error("Owned PostgreSQL live identity proof failed")
}
