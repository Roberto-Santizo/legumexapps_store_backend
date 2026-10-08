import { ImportColumnDef } from "../../../shared/utils/excelImport.util"

export type ClientImportField = "name"

export const CLIENT_IMPORT_COLUMNS: Record<ClientImportField, ImportColumnDef> = {
    name: { header: "Nombre", aliases: ["nombre", "name"] },
}

export const REQUIRED_CLIENT_IMPORT_FIELDS: ClientImportField[] = ["name"]
export const MAX_CLIENT_IMPORT_ROWS = 1000
