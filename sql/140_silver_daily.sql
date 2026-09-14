-- SILVER daily: one row per brand x keyword x day that SHOULD have data.
-- The expected grid is (pairs ever seen) x (days ever seen); days before a pair
-- first appeared also get rows, but the anomaly logic ignores them (they are
-- "not yet monitored", not "went missing"). Anchoring to the expected grid is
-- what makes absence a row: a day with no run gets runs_seen = 0 and a day
-- with a run but zero ads gets ads_seen = 0 — both visible, both alertable.
CREATE OR REPLACE TABLE silver_daily AS
WITH grid AS (
    SELECT DISTINCT brand, keyword, geo FROM silver_runs
),
days AS (
    SELECT DISTINCT dt FROM silver_runs
),
expected AS (
    SELECT g.brand, g.keyword, g.geo, d.dt FROM grid g CROSS JOIN days d
),
per_run AS (
    SELECT
        r.run_id, r.dt, r.brand, r.keyword, r.geo,
        r.ads_expected,
        count(o.run_id) AS ads_seen
    FROM silver_runs r
    LEFT JOIN silver_observations o USING (run_id)
    GROUP BY ALL
),
per_run_day AS (
    SELECT
        dt, brand, keyword, geo,
        count(*)          AS runs_seen,
        sum(ads_expected) AS ads_expected,
        sum(ads_seen)     AS ads_seen
    FROM per_run
    GROUP BY dt, brand, keyword, geo
),
per_day_class AS (
    SELECT
        dt, brand, keyword, geo,
        count(*) FILTER (WHERE classification = 'affiliate_violation') AS violations,
        count(*) FILTER (WHERE classification = 'competitor_conquest') AS conquests,
        count(*) FILTER (WHERE classification = 'self_bid')            AS self_bids,
        count(*) FILTER (WHERE classification = 'unknown')             AS unknowns,
        list(DISTINCT display_domain ORDER BY display_domain)          AS advertisers
    FROM silver_observations
    GROUP BY dt, brand, keyword, geo
)
SELECT
    e.dt, e.brand, e.keyword, e.geo,
    coalesce(p.runs_seen, 0)     AS runs_seen,
    coalesce(p.ads_expected, 0)  AS ads_expected,
    coalesce(p.ads_seen, 0)      AS ads_seen,
    -- capture_ratio < 1 means the parser saw fewer ads than the fetch reported
    CASE WHEN coalesce(p.ads_expected, 0) > 0
         THEN coalesce(p.ads_seen, 0)::DOUBLE / p.ads_expected
    END                          AS capture_ratio,
    coalesce(c.advertisers, [])  AS advertisers,
    len(coalesce(c.advertisers, [])) AS advertisers_n,
    coalesce(c.violations, 0)    AS violations,
    coalesce(c.conquests, 0)     AS conquests,
    coalesce(c.self_bids, 0)     AS self_bids,
    coalesce(c.unknowns, 0)      AS unknowns
FROM expected e
LEFT JOIN per_run_day  p USING (dt, brand, keyword, geo)
LEFT JOIN per_day_class c USING (dt, brand, keyword, geo);
