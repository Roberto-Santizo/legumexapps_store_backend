// Un borrador in_progress cuya última actividad (updatedAt) es más vieja que esto se muestra como
// "Abandonada". Se calcula al leer (quoteDraftService.listDrafts), no hay job en segundo plano.
export const DRAFT_ABANDONED_AFTER_HOURS = 24
