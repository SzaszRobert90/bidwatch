-- SILVER: one row per inspected landing. The nested inspection struct is
-- flattened to scalar columns; hops/matches stay as lists of structs because
-- their length varies per row and gold renders evidence strings on the way out.
CREATE OR REPLACE TABLE silver_landings AS
SELECT
    runId::VARCHAR                          AS run_id,
    brand::VARCHAR                          AS brand,
    keyword::VARCHAR                        AS keyword,
    geo::VARCHAR                            AS geo,
    engine::VARCHAR                         AS engine,
    dt::DATE                                AS dt,
    fetchedAt::TIMESTAMP                    AS fetched_at,
    adIndex::INTEGER                        AS ad_index,
    title::VARCHAR                          AS title,
    displayDomain::VARCHAR                  AS display_domain,
    clickUrl::VARCHAR                       AS click_url,
    classification::VARCHAR                 AS classification,
    coalesce(networks, [])::VARCHAR[]       AS networks,
    "inspection"['requestDomain']::VARCHAR  AS request_domain,
    "inspection"['finalDomain']::VARCHAR    AS final_domain,
    "inspection"['httpStatus']::INTEGER     AS http_status,
    "inspection"['error']::VARCHAR          AS inspection_error,
    "inspection"['adMetaUrl']::VARCHAR      AS ad_meta_url,
    "inspection"['hops']                    AS hops,
    "inspection"['matches']                 AS matches
FROM bronze_landings;
