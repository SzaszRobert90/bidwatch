-- GOLD evidence: landing-level detail behind the aggregates, for the per-brand
-- markdown packs. Stays landing-grained (not daily) so aggregation upstream
-- never destroys the evidence chain; the worker only inspects third-party ads,
-- so self-bids never appear here by construction.
-- `coalesce` everywhere: empty list aggregates and JSON nulls come back NULL,
-- and consumers should see [] rather than NULL.
CREATE OR REPLACE TABLE gold_evidence AS
SELECT
    dt, brand, keyword, run_id, ad_index, classification, title,
    display_domain, final_domain, inspection_error,
    coalesce(networks, []) AS networks,
    coalesce(list_transform(matches, m -> m['evidence'] || ' (' || m['source'] || ')'), []) AS evidence
FROM silver_landings;
