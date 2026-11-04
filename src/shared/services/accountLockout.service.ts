import type { Transaction } from "sequelize"

const MAX_FAILED_ATTEMPTS = 5
const LOCK_DURATION_MS = 15 * 60 * 1000

interface LockableAccount {
    failed_attempts: number
    locked_until: Date | null
    update(values: { failed_attempts: number; locked_until: Date | null }, options?: { transaction: Transaction }): Promise<unknown>
}

export function isAccountLocked(account: Pick<LockableAccount, "locked_until">): boolean {
    return account.locked_until !== null && account.locked_until.getTime() > Date.now()
}

// Login callers hold the account's UPDATE row lock until these counters are committed.
export async function registerFailedAttempt(account: LockableAccount, transaction?: Transaction): Promise<void> {
    const failedAttempts = account.failed_attempts + 1
    const isNowLocked = failedAttempts >= MAX_FAILED_ATTEMPTS
    const values = {
        failed_attempts: isNowLocked ? 0 : failedAttempts,
        locked_until: isNowLocked ? new Date(Date.now() + LOCK_DURATION_MS) : null
    }
    if (transaction) await account.update(values, { transaction })
    else await account.update(values)
}

export async function clearFailedAttempts(account: LockableAccount, transaction?: Transaction): Promise<void> {
    if (account.failed_attempts > 0 || account.locked_until) {
        const values = { failed_attempts: 0, locked_until: null }
        if (transaction) await account.update(values, { transaction })
        else await account.update(values)
    }
}
