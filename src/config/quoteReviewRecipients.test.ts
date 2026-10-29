import { parseQuoteReviewRecipients } from "./quoteReviewRecipients"

describe("parseQuoteReviewRecipients", () => {
    it.each([undefined, "", "   "])("sin valor (%p) no hay destinatarios: la app arranca y no avisa a nadie", value => {
        expect(parseQuoteReviewRecipients(value)).toEqual([])
    })

    it("acepta uno o varios correos separados por coma, sin espacios sobrantes", () => {
        expect(parseQuoteReviewRecipients("review@example.invalid")).toEqual(["review@example.invalid"])
        expect(parseQuoteReviewRecipients(" a@example.invalid , b@example.invalid ")).toEqual(["a@example.invalid", "b@example.invalid"])
    })

    it.each(["not-an-email", "a@example.invalid,", "a@example.invalid;b@example.invalid", "a@example.invalid,A@example.invalid"])("un valor mal escrito (%p) impide arrancar", value => {
        expect(() => parseQuoteReviewRecipients(value)).toThrow("Invalid QUOTE_REVIEW_EMAIL")
    })
})
