-- Export gold as Parquet, hive-partitioned by dt, into the curated bucket.
-- Consumers get typed, columnar files prunable by day instead of per-run JSONL.
-- The transform is a full idempotent recompute (CREATE OR REPLACE from immutable
-- bronze), so OVERWRITE_OR_IGNORE rewrites every partition; note it does not
-- delete partitions for days that vanish — days only accumulate here.
COPY gold_daily
TO '__CURATED_LAKE__/gold/daily_brand_keyword'
(FORMAT PARQUET, PARTITION_BY (dt), OVERWRITE_OR_IGNORE);
