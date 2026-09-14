-- SILVER dqi: rows that violate expectations — anomaly detection for the
-- pipeline itself. Business anomalies (gold_anomalies) are only trustworthy
-- when the data feeding them is; these checks keep the meter honest.
CREATE OR REPLACE TABLE silver_dqi AS
WITH per_run AS (
    SELECT
        r.run_id, r.dt, r.brand, r.keyword,
        r.ads_expected,
        count(o.run_id) AS ads_seen
    FROM silver_runs r
    LEFT JOIN silver_observations o USING (run_id)
    GROUP BY ALL
),
hop_failures AS (
    SELECT run_id, ad_index,
           list_transform(
               list_filter(hops, h -> h['status'] >= 400),
               h -> h['url'] || ' -> ' || h['status']::VARCHAR
           ) AS bad_hops
    FROM silver_landings
)
-- 1. raw and curated layers disagree on how many ads the SERP had
SELECT dt, brand, keyword, run_id,
       'capture_mismatch' AS check_name,
       'ads_expected=' || ads_expected || ', ads_seen=' || ads_seen AS detail
FROM per_run
WHERE ads_seen <> ads_expected
UNION ALL
-- 2. the engine flagged the fetch (e.g. "captcha suspected")
SELECT dt, brand, keyword, run_id, 'serp_notice', notice
FROM silver_runs
WHERE notice IS NOT NULL
UNION ALL
-- 3. landing could not be inspected at all
SELECT dt, brand, keyword, run_id, 'landing_error',
       ad_index::VARCHAR || ': ' || inspection_error
FROM silver_landings
WHERE inspection_error IS NOT NULL
UNION ALL
-- 4. landing finished on a non-200
SELECT dt, brand, keyword, run_id, 'landing_http_' || http_status::VARCHAR, final_domain
FROM silver_landings
WHERE http_status <> 200
UNION ALL
-- 5. a redirect hop inside the chain failed
SELECT l.dt, l.brand, l.keyword, l.run_id, 'hop_failed',
       array_to_string(h.bad_hops, '; ')
FROM silver_landings l
JOIN hop_failures h ON h.run_id = l.run_id AND h.ad_index = l.ad_index
WHERE len(h.bad_hops) > 0
UNION ALL
-- 6. observations with no meta.json (raw layer missing or truncated)
SELECT o.dt, o.brand, o.keyword, o.run_id, 'orphan_observations', 'no meta.json for run'
FROM silver_observations o
WHERE NOT EXISTS (SELECT 1 FROM silver_runs r WHERE r.run_id = o.run_id);
