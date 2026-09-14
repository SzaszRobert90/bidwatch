-- GOLD anomalies: one row per (day, brand, keyword, kind, entity). Pure SQL
-- detection — trailing-window statistics and anti-joins, no procedural code.
-- Small-n honesty: at ~1 run/day, z-scores are noise until history accumulates,
-- so the volume check demands >= 3 prior days AND nonzero spread. Days before a
-- pair was first monitored never alert (base_max guard below).
CREATE OR REPLACE TABLE gold_anomalies AS
WITH hist AS (
    SELECT *,
        count(*)              OVER w AS base_n,
        avg(ads_seen)         OVER w AS base_mean,
        stddev_samp(ads_seen) OVER w AS base_sd,
        max(ads_seen)         OVER w AS base_max
    FROM silver_daily
    WINDOW w AS (PARTITION BY brand, keyword ORDER BY dt
                 ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING)
),
-- 1. the brand went dark: a day with no run or no ads after a week that had ads
disappearance AS (
    SELECT dt, brand, keyword,
           CASE WHEN runs_seen = 0 THEN 'missing_run' ELSE 'disappearance' END AS kind,
           CAST(ads_seen AS VARCHAR) AS entity,
           'ads_seen=' || ads_seen || ', runs_seen=' || runs_seen
           || ', prior 7d max=' || coalesce(base_max, 0) AS detail
    FROM hist
    WHERE (runs_seen = 0 OR ads_seen = 0) AND coalesce(base_max, 0) > 0
),
-- 2. ad volume deviates >= 2 sigma from the trailing 7 days
volume_shift AS (
    SELECT dt, brand, keyword,
           CASE WHEN ads_seen > base_mean THEN 'volume_spike' ELSE 'volume_drop' END AS kind,
           CAST(ads_seen AS VARCHAR) AS entity,
           'ads_seen=' || ads_seen || ', baseline ~' || round(base_mean, 1)
           || ' +/- ' || round(base_sd, 1) AS detail
    FROM hist
    WHERE ads_seen > 0 AND base_n >= 3 AND base_sd > 0
      AND abs(ads_seen - base_mean) >= 2 * base_sd
),
-- 3. new entrant: an advertiser domain never seen on this pair in the prior 28
--    days. The brand's own domain is excluded — that is self-bidding, expected.
--    First-ever sightings (cold start) legitimately count as entrants.
new_entrant AS (
    SELECT o.dt, o.brand, o.keyword, 'new_entrant' AS kind,
           o.display_domain AS entity,
           'first sighting on this keyword; classification=' || o.classification AS detail
    FROM silver_observations o
    WHERE o.display_domain <> o.brand_domain
      AND o.classification <> 'self_bid'
      AND NOT EXISTS (
            SELECT 1 FROM silver_observations p
            WHERE p.brand = o.brand
              AND p.keyword = o.keyword
              AND p.display_domain = o.display_domain
              AND p.dt >= o.dt - INTERVAL 28 DAY
              AND p.dt < o.dt)
),
-- 4. pipeline quality problems escalate into the business view (one row per
--    dqi finding, so consumers can filter kind='data_quality' or drill in)
dqi_escalation AS (
    SELECT dt, brand, keyword, 'data_quality' AS kind, check_name AS entity, detail
    FROM silver_dqi
)
SELECT dt, brand, keyword, kind, entity, detail FROM disappearance
UNION ALL SELECT dt, brand, keyword, kind, entity, detail FROM volume_shift
UNION ALL SELECT dt, brand, keyword, kind, entity, detail FROM new_entrant
UNION ALL SELECT dt, brand, keyword, kind, entity, detail FROM dqi_escalation;
