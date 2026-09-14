-- BRONZE: the lake exactly as the worker wrote it, untyped and unreshaped.
-- meta.json exists for EVERY run (zero-ad runs included), so this view is the
-- only complete run inventory. hive_partitioning lifts engine/dt/run out of the
-- S3 key into columns for free; format='unstructured' because each file is one
-- pretty-printed JSON object, not NDJSON. union_by_name absorbs schema drift
-- (already happened once: old rows predate inspection.adMetaUrl).
CREATE OR REPLACE VIEW bronze_runs AS
SELECT *
FROM read_json('__RAW_LAKE__/raw/engine=*/dt=*/run=*/meta.json',
               format = 'unstructured', union_by_name = true, hive_partitioning = true);
