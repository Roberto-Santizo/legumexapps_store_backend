import { isAccountLocked, registerFailedAttempt, clearFailedAttempts } from "./accountLockout.service"

interface FakeAccount {
    failed_attempts: number
    locked_until: Date | null
    update: jest.Mock<Promise<FakeAccount>, [{ failed_attempts: number; locked_until: Date | null }]>
}

// Cuenta falsa que se comporta como un modelo Sequelize lo suficiente para este servicio:
// guarda los valores que le pasan a `update` en sí misma, igual que persistiría una fila real.
function fakeAccount(overrides: { failed_attempts?: number; locked_until?: Date | null } = {}): FakeAccount {
    const account: FakeAccount = {
        failed_attempts: overrides.failed_attempts ?? 0,
        locked_until: overrides.locked_until ?? null,
        update: jest.fn(),
    }
    account.update.mockImplementation(async values => {
        account.failed_attempts = values.failed_attempts
        account.locked_until = values.locked_until
        return account
    })
    return account
}

describe("isAccountLocked", () => {
    it("no está bloqueada si locked_until es null", () => {
        expect(isAccountLocked({ locked_until: null })).toBe(false)
    })

    it("está bloqueada si locked_until es una fecha futura", () => {
        expect(isAccountLocked({ locked_until: new Date(Date.now() + 60_000) })).toBe(true)
    })

    it("ya no está bloqueada si locked_until quedó en el pasado", () => {
        expect(isAccountLocked({ locked_until: new Date(Date.now() - 60_000) })).toBe(false)
    })
})

describe("registerFailedAttempt", () => {
    it("incrementa el contador en cada intento fallido sin bloquear todavía", async () => {
        const account = fakeAccount({ failed_attempts: 1 })

        await registerFailedAttempt(account)

        expect(account.failed_attempts).toBe(2)
        expect(account.locked_until).toBeNull()
    })

    it("bloquea la cuenta al llegar al 5to intento fallido", async () => {
        const account = fakeAccount({ failed_attempts: 4 })

        await registerFailedAttempt(account)

        expect(isAccountLocked(account)).toBe(true)
        // El bloqueo dura ~15 minutos desde ahora.
        const minutesUntilUnlock = (account.locked_until!.getTime() - Date.now()) / 60_000
        expect(minutesUntilUnlock).toBeGreaterThan(14)
        expect(minutesUntilUnlock).toBeLessThanOrEqual(15)
    })

    it("resetea el contador a 0 en el intento que dispara el bloqueo", async () => {
        const account = fakeAccount({ failed_attempts: 4 })

        await registerFailedAttempt(account)

        expect(account.failed_attempts).toBe(0)
    })
})

describe("clearFailedAttempts", () => {
    it("resetea contador y bloqueo tras un login exitoso", async () => {
        const account = fakeAccount({ failed_attempts: 3, locked_until: new Date(Date.now() + 60_000) })

        await clearFailedAttempts(account)

        expect(account.failed_attempts).toBe(0)
        expect(account.locked_until).toBeNull()
        expect(account.update).toHaveBeenCalledTimes(1)
    })

    it("no llama a update si la cuenta ya estaba limpia (evita un write innecesario)", async () => {
        const account = fakeAccount({ failed_attempts: 0, locked_until: null })

        await clearFailedAttempts(account)

        expect(account.update).not.toHaveBeenCalled()
    })
})
