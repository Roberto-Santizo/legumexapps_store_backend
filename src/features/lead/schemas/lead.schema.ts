import { z } from "zod"
import { paginationQuerySchema } from "../../../shared/schemas/pagination.schema"

export const leadStatusEnum = z.enum(["new", "contacted"])

// Formulario público de la landing (sin auth, ver lead.routes.ts). "website" es un honeypot: un
// campo oculto en el form real que ningún humano llena -- si un bot lo completa, el controller lo
// detecta y descarta el envío en silencio (ver lead.controller.ts::store), sin delatar la trampa
// con un error distinto.
export const publicCreateLeadSchema = z.object({
    fullName: z.string().trim().min(1).max(150),
    companyName: z.string().trim().min(1).max(150),
    phone: z.string().trim().min(1).max(30),
    email: z.string().trim().min(1).pipe(z.email()),
    productLineInterest: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(2000).optional(),
    website: z.string().trim().max(200).optional(),
})

export const updateLeadSchema = z.object({
    status: leadStatusEnum.optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
})

// Datos de contacto capturados en el COTIZADOR del cliente (2026-09-13, ver
// quoteService.saveQuote / leadService.findOrCreateLeadForQuote) -- reusa los mismos validadores
// de publicCreateLeadSchema (nombre/empresa/email/notas) en vez de retipearlos, para que ambos
// orígenes de Lead (formulario público de la landing y el cotizador) queden validados igual.
// A propósito NO incluye phone/productLineInterest/website: el cotizador no los captura (ver
// Lead.model.ts, phone ya es opcional en la columna física por este mismo motivo).
export const quoteLeadContactSchema = z.object({
    fullName: publicCreateLeadSchema.shape.fullName,
    companyName: publicCreateLeadSchema.shape.companyName,
    email: publicCreateLeadSchema.shape.email,
    notes: publicCreateLeadSchema.shape.notes,
})

export const leadIdParamSchema = z.object({
    id: z.string().regex(/^\d+$/),
})

export const leadQuerySchema = paginationQuerySchema.extend({
    search: z.string().trim().optional(),
    status: leadStatusEnum.optional(),
})

export type LeadStatusInput = z.infer<typeof leadStatusEnum>
export type PublicCreateLeadInput = z.infer<typeof publicCreateLeadSchema>
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>
export type QuoteLeadContactInput = z.infer<typeof quoteLeadContactSchema>
export type LeadQuery = z.infer<typeof leadQuerySchema>
