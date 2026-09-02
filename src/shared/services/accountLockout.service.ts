const MAX_FAILED_ATTEMPTS = 5
const LOCK_DURATION_MS = 15 * 60 * 1000

interface LockableAccount {
    failed_attempts: number
    locked_until: Date | null
    update(values: { failed_attempts: number; locked_until: Date | null }): Promise<unknown>
}

export function isAccountLocked(account: Pick<LockableAccount, "locked_until">): boolean {
    return account.locked_until !== null && account.locked_until.getTime() > Date.now()
}

export async function registerFailedAttempt(account: LockableAccount): Promise<void> {
    const failedAttempts = account.failed_attempts + 1
    const isNowLocked = failedAttempts >= MAX_FAILED_ATTEMPTS
    await account.update({
        failed_attempts: isNowLocked ? 0 : failedAttempts,
        locked_until: isNowLocked ? new Date(Date.now() + LOCK_DURATION_MS) : null
    })
}

export async function clearFailedAttempts(account: LockableAccount): Promise<void> {
    if (account.failed_attempts > 0 || account.locked_until) {
        await account.update({ failed_attempts: 0, locked_until: null })
    }
}
