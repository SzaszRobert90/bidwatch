-- One row per ad seen on a SERP (worker output). Zero-ad runs emit no file
-- here — that silence is exactly why silver_runs is built from meta.json
-- instead: absence must be a row with zeros, not a missing row.
CREATE OR REPLACE VIEW bronze_observations AS
SELECT *
FROM read_json('__CURATED_LAKE__/curated/observations/**/*.jsonl',
               format = 'newline_delimited', union_by_name = true, hive_partitioning = true);
