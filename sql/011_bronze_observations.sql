-- One row per ad seen on a SERP (worker output). Zero-ad runs emit no file
-- here — that silence is exactly why silver_runs is built from meta.json
-- instead: absence must be a row with zeros, not a missing row.
-- __OBSERVATIONS_SOURCE__: lake glob, or the seed file when the prefix is
-- empty (read_json refuses empty globs); the seed types the relation and is
-- filtered out by its own filename.
CREATE OR REPLACE VIEW bronze_observations AS
SELECT *
FROM read_json('__OBSERVATIONS_SOURCE__',
               format = 'newline_delimited', union_by_name = true, filename = true, hive_partitioning = true)
WHERE filename <> '__OBSERVATIONS_SOURCE__';
