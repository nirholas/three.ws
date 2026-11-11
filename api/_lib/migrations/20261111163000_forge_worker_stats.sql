-- Migration: per-creation worker telemetry on forge_creations.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261111163000_forge_worker_stats.sql
-- Idempotent, additive (nullable columns, no backfill).
--
-- The TRELLIS.2 worker measures each task itself and returns the numbers on
-- its status reply: the voxel resolution that actually ran, milliseconds spent
-- queued behind other tasks, and milliseconds of GPU time.
-- api/_lib/forge-store.js (recordWorkerStats) writes them when the creation
-- completes. scripts/trellis2-benchmark.mjs reads them for queue and GPU
-- percentiles and to split the lab's presets by resolution. Null means the
-- serving lane did not report the value (not measured), never zero.

ALTER TABLE forge_creations ADD COLUMN IF NOT EXISTS voxel_resolution smallint;
ALTER TABLE forge_creations ADD COLUMN IF NOT EXISTS queue_ms integer;
ALTER TABLE forge_creations ADD COLUMN IF NOT EXISTS gpu_ms integer;
