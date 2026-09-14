-- SILVER: one row per ad observation, typed and snake_case (camelCase stops at
-- the bronze->silver boundary; everything downstream is snake_case).
CREATE OR REPLACE TABLE silver_observations AS
SELECT
    runId::VARCHAR             AS run_id,
    brand::VARCHAR             AS brand,
    brandDomain::VARCHAR       AS brand_domain,
    keyword::VARCHAR           AS keyword,
    geo::VARCHAR               AS geo,
    engine::VARCHAR            AS engine,
    dt::DATE                   AS dt,
    fetchedAt::TIMESTAMP       AS fetched_at,
    adIndex::INTEGER           AS ad_index,
    title::VARCHAR             AS title,
    displayUrl::VARCHAR        AS display_url,
    displayDomain::VARCHAR     AS display_domain,
    clickUrl::VARCHAR          AS click_url,
    classification::VARCHAR    AS classification,
    inspected::BOOLEAN         AS inspected
FROM bronze_observations;
