import cors from "cors"

export function frontendCors(origin: string) {
    return cors({ origin: (requestOrigin, callback) => callback(null, requestOrigin === origin ? origin : false) })
}
