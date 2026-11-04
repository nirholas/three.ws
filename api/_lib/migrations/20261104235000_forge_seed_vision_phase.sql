-- forge_seed_jobs: the columns the catalog vision phase runs on.
--
-- Stage 2 of the catalog quality gate (render + Vertex judge) costs 10 to 20 s
-- per asset, and the seed cron has a hard 70 s wall, so it never ran in
-- production. With SEED_VISION_PHASE=1 the seed cron stops after the mesh gate
-- and parks a keeper in status 'mesh_passed' (status is free text, see
-- 20260615010000); api/cron/forge-seed-vision-cron.js judges it under its own
-- budget and then publishes or quarantines it.
--
-- mesh_passed_at     when the row entered 'mesh_passed'. Orders the vision queue
--                    and enforces the 30 minute bound: past it the keeper is
--                    published on its mesh verdict, marked vision_unavailable.
-- vision_lease_until a claim, not a lock. The serverless driver commits every
--                    statement on its own, so FOR UPDATE SKIP LOCKED only
--                    arbitrates inside the claiming UPDATE; the lease is what
--                    keeps a second overlapping tick off a row while the first
--                    is still judging it. An expired lease is free again, so a
--                    tick that dies mid-judge never strands its rows.
--
-- Additive only: existing rows keep every value they had, and both columns are
-- nullable with no default, so the ALTERs are metadata-only.

ALTER TABLE forge_seed_jobs ADD COLUMN IF NOT EXISTS mesh_passed_at timestamptz;
ALTER TABLE forge_seed_jobs ADD COLUMN IF NOT EXISTS vision_lease_until timestamptz;

CREATE INDEX IF NOT EXISTS forge_seed_jobs_mesh_passed_idx
	ON forge_seed_jobs (mesh_passed_at)
	WHERE status = 'mesh_passed';
