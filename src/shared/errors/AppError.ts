export class AppError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly key: string,
        public readonly params?: Record<string, unknown>
    ) {
        super(key)
        this.name = this.constructor.name
    }
}

export class NotFoundError extends AppError {
    constructor(resource: string, id: number | string) {
        super(404, "errors.not_found", { resource, id })
    }
}

export class ExcelImportParseError extends AppError {
    constructor(public readonly cause: unknown, public readonly fallbackCause?: unknown) {
        super(422, "errors.bulk_import_unreadable_xlsx")
    }
}


export interface RowIssue {
    sheet?: string
    row: number
    field: string
    key: string
    params?: Record<string, unknown>
}


export class BulkImportError extends AppError {
    constructor(public readonly rowIssues: RowIssue[]) {
        super(422, "errors.bulk_import_invalid_rows")
    }
}
