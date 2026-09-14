-- BRONZE: the lake exactly as the worker wrote it, untyped and unreshaped.
-- meta.json exists for EVERY run (zero-ad runs included), so this view is the
-- only complete run inventory. hive_partitioning lifts engine/dt/run out of the
-- S3 key into columns for free; format='unstructured' because each file is one
-- pretty-printed JSON object, not NDJSON. union_by_name absorbs schema drift
-- (already happened once: old rows predate inspection.adMetaUrl).
-- __RUNS_SOURCE__ is substituted by the runner: the lake glob when the prefix
-- has objects, else the shipped seed file (sql/seeds/runs.json) — read_json
-- refuses empty globs, and a fresh lake must transform cleanly. The seed row
-- only types the relation; the view filters it out by its own filename.
CREATE OR REPLACE VIEW bronze_runs AS
SELECT *
FROM read_json('__RUNS_SOURCE__',
               format = 'unstructured', union_by_name = true, filename = true, hive_partitioning = true)
WHERE filename <> '__RUNS_SOURCE__';
