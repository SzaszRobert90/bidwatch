-- SILVER contract: one row per scrape attempt, typed, snake_case. Built from
-- the RAW side (meta.json), not from the observations extract, so zero-ad runs
-- and "feeder fired but the job died" days stay representable as rows.
-- This is the layer that turns schema drift into loud failures: a missing or
-- renamed field fails the CAST here, at the boundary, instead of silently
-- propagating NULLs into reports downstream.
CREATE OR REPLACE TABLE silver_runs AS
SELECT
    "query"['runId']::VARCHAR             AS run_id,
    "query"['brand']::VARCHAR             AS brand,
    "query"['brandDomain']::VARCHAR       AS brand_domain,
    "query"['keyword']::VARCHAR           AS keyword,
    "query"['geo']::VARCHAR               AS geo,
    "query"['engine']::VARCHAR            AS engine,
    dt::DATE                              AS dt,
    adCount::INTEGER                      AS ads_expected,
    notice::VARCHAR                       AS notice,
    finalUrl::VARCHAR                     AS final_url,
    -- JSON reader parses ISO strings as naive UTC wall-clock TIMESTAMP; kept
    -- naive deliberately (all pipeline timestamps are UTC) to avoid session-tz
    -- reinterpretation on the TIMESTAMPTZ cast.
    fetchedAt::TIMESTAMP                  AS fetched_at
FROM bronze_runs;
