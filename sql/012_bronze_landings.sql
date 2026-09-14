-- One row per inspected landing, `inspection` kept nested here; silver flattens
-- it. The `**` glob tolerates layout changes below landings/ (e.g. dropping the
-- run= level from the writer later) without touching this layer.
-- __LANDINGS_SOURCE__: lake glob, or the seed file when the prefix is empty
-- (read_json refuses empty globs — CI buckets and the AWS migration start
-- empty); the seed types the relation and is filtered out by its own filename.
CREATE OR REPLACE VIEW bronze_landings AS
SELECT *
FROM read_json('__LANDINGS_SOURCE__',
               format = 'newline_delimited', union_by_name = true, filename = true, hive_partitioning = true)
WHERE filename <> '__LANDINGS_SOURCE__';
