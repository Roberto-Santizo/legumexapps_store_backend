jest.mock("../models/QuoteOrderReview.model", () => ({ __esModule: true, default: { findAll: jest.fn() } }))

import QuoteOrderReview from "../models/QuoteOrderReview.model"
import { approvedQuoteIds, approvedQuoteProfits } from "./approvedQuoteProfits"

const findAll = QuoteOrderReview.findAll as unknown as jest.Mock
const amounts = { netPounds: 100, profitPerPound: 0.25, profitTotal: 25, finalPrice: 125 }
const review = (lines: unknown, orderId = "order-1") => ({ orderId, pricing: { lines } })

beforeEach(() => jest.spyOn(console, "warn").mockImplementation(() => undefined))
afterEach(() => jest.restoreAllMocks())

test("reads only approved reviews and keeps the same id apart by kind", async () => {
    findAll.mockResolvedValue([review([{ kind: "fixed", quoteId: 7, productDisplayName: "x", totalCost: 100, ...amounts }, { kind: "customizable", quoteId: 7, ...amounts, finalPrice: 999 }])])
    expect(await approvedQuoteProfits("fixed")).toEqual(new Map([[7, amounts]]))
    expect((await approvedQuoteProfits("customizable")).get(7)?.finalPrice).toBe(999)
    expect(findAll.mock.calls[0][0].where).toEqual({ status: "approved" })
    expect(await approvedQuoteIds()).toEqual({ fixed: [7], customizable: [7] })
})

test("limits the query to one order when given", async () => {
    findAll.mockResolvedValue([])
    await approvedQuoteProfits("customizable", "order-9")
    expect(findAll.mock.calls[0][0].where).toEqual({ status: "approved", orderId: "order-9" })
})

test("malformed stored pricing is skipped instead of breaking the listings", async () => {
    findAll.mockResolvedValue([
        { orderId: "null-pricing", pricing: null },
        review({}, "object-lines"),
        review("text", "string-lines"),
        review([null, "x", { kind: "fixed", quoteId: 1 }, { kind: "other", quoteId: 2, ...amounts }, { kind: "fixed", quoteId: "3", ...amounts }, { kind: "fixed", quoteId: 4, ...amounts, finalPrice: "125" }, { kind: "fixed", quoteId: 5, ...amounts }], "mixed"),
    ])
    expect(await approvedQuoteProfits("fixed")).toEqual(new Map([[5, amounts]]))
    expect(console.warn).toHaveBeenCalled()
})
