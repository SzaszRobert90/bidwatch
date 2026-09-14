-- GOLD: the curated product. One row per brand x keyword x day with the
-- metrics a consumer needs, plus anomaly context pre-joined so consumers never
-- have to reconstruct it. This is the table the report app (and anything else)
-- reads; the layers below it are internal to the transform.
CREATE OR REPLACE TABLE gold_daily AS
WITH flagged AS (
    SELECT
        dt, brand, keyword,
        coalesce(list(DISTINCT entity) FILTER (WHERE kind = 'new_entrant'), []) AS new_entrants,
        coalesce(list(DISTINCT kind) FILTER (WHERE kind <> 'data_quality'), []) AS anomaly_flags,
        count(*) FILTER (WHERE kind = 'data_quality')                           AS dqi_open
    FROM gold_anomalies
    GROUP BY dt, brand, keyword
)
SELECT
    d.dt, d.brand, d.keyword, d.geo,
    d.runs_seen, d.ads_expected, d.ads_seen, d.capture_ratio,
    d.advertisers, d.advertisers_n,
    d.violations, d.conquests, d.self_bids, d.unknowns,
    d.violations::DOUBLE / NULLIF(d.violations + d.conquests + d.self_bids + d.unknowns, 0)
        AS violation_share,
    f.new_entrants,
    f.anomaly_flags,
    coalesce(f.dqi_open, 0) AS dqi_open
FROM silver_daily d
LEFT JOIN flagged f USING (dt, brand, keyword);
