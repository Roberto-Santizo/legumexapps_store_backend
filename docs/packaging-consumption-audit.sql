-- READ ONLY: inspect ALL persisted associations, including inactive overrides.
-- Results are candidates for human review, never automatic default assignments.
WITH rules AS (
    SELECT "packagingId", COUNT(*) AS association_count,
        COUNT(*) FILTER (WHERE "isActive") AS active_association_count,
        COUNT(DISTINCT ("quantityBasis", "quantityValue")) AS distinct_rules,
        BOOL_OR("quantityBasis" IS NULL OR "quantityBasis"::text NOT IN ('per_box', 'per_pallet')
            OR "quantityValue" IS NULL OR "quantityValue" <= 0 OR "quantityValue" > 99999999.99) AS invalid_rule,
        JSONB_AGG(DISTINCT JSONB_BUILD_OBJECT('basis', "quantityBasis", 'quantity', "quantityValue")) AS observed_rules
    FROM "productVariantPalletMaterials"
    GROUP BY "packagingId"
)
SELECT p."id", p."code", p."displayName", p."isActive",
    p."defaultQuantityBasis", p."defaultQuantityValue",
    COALESCE(r.association_count, 0) AS association_count,
    COALESCE(r.active_association_count, 0) AS active_association_count,
    r.observed_rules,
    CASE WHEN r.association_count IS NULL THEN 'SIN ASOCIACIONES: CONFIGURAR EXPLICITAMENTE'
         WHEN r.invalid_rule THEN 'REGLA INVALIDA: REVISAR'
         WHEN r.distinct_rules = 1 THEN 'CANDIDATO UNIFORME: REQUIERE APROBACION'
         ELSE 'CONFLICTO: DIFERENTES REGLAS EFECTIVAS' END AS status
FROM "packagings" p LEFT JOIN rules r ON r."packagingId" = p."id"
WHERE p."packagingRole" = 'pallet'
ORDER BY p."code";
