import { z } from "zod"

// Paginación opt-in: page/limit son opcionales a propósito. Si el caller no manda "page", el
// controller/service tratan la request como el listado completo de siempre (sin paginar) -- así
// es como los *Select.component.tsx del front, que reusan el mismo endpoint GET "/" que las
// tablas admin pero sin mandar page/limit, siguen recibiendo la lista completa sin que haga falta
// tocarlos. Ver pagination.util.ts para el lado que arma la respuesta.
export const paginationQuerySchema = z.object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
})
