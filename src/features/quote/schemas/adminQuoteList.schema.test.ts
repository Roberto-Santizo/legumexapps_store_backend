import { adminQuoteListQuerySchema } from "./adminQuoteList.schema"
import { listCustomQuotesQuerySchema } from "../../customQuote/schemas/adminCustomQuote.schema"

describe("fixed and customizable date contract", () => {
    it.each([{}, { startDate: "2026-10-01" }, { endDate: "2026-10-07" }, { startDate: "2026-10-07", endDate: "2026-10-07" }])("accepts the same valid range %j", range => {
        expect(adminQuoteListQuerySchema.safeParse(range).success).toBe(true)
        expect(listCustomQuotesQuerySchema.safeParse(range).success).toBe(true)
    })
    it.each([{ startDate: "2026-10-08", endDate: "2026-10-07" }, { startDate: "2026-02-30" }, { endDate: "2026-10-07T00:00:00Z" }])("rejects the same invalid range %j", range => {
        expect(adminQuoteListQuerySchema.safeParse(range).success).toBe(false)
        expect(listCustomQuotesQuerySchema.safeParse(range).success).toBe(false)
    })
})
