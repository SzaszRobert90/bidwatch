-- One row per inspected landing, `inspection` kept nested here; silver flattens
-- it. The `**` glob tolerates layout changes below landings/ (e.g. dropping the
-- run= level from the writer later) without touching this layer.
CREATE OR REPLACE VIEW bronze_landings AS
SELECT *
FROM read_json('__CURATED_LAKE__/curated/landings/**/*.jsonl',
               format = 'newline_delimited', union_by_name = true, hive_partitioning = true);
