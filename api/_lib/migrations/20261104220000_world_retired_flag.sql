-- Formally retire world.three.ws (Hyperfy). The owner deleted the hyperfy-world
-- Cloud Run service on 2026-10-23 (deploy/world/README.md), so every probe of it
-- 404s. The 'world_retired' runtime flag (api/_lib/world-retirement.js) tells the
-- world-health cron, the forge-health probe and the /healthz subsystem gatherer
-- to report a neutral "retired" state instead of "down".
--
-- Idempotent: an operator who later flips the flag off must not be overridden by a
-- re-run, so an existing row is left untouched.
-- Reverse: update app_flags set enabled = false where key = 'world_retired';
INSERT INTO app_flags (key, enabled, value, updated_at)
VALUES ('world_retired', true, '{"retired_on":"2026-10-23","restore":"bash deploy/world/apply-hardening.sh"}'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

-- Close the open world-health alerts raised against the deleted service. Scoped to
-- that signature family and to rows nobody has acknowledged; reversible by
-- clearing acknowledged_at/acknowledged_by on the same signatures.
UPDATE ops_alerts
   SET acknowledged_at = now(),
       acknowledged_by = 'world-retirement'
 WHERE signature LIKE 'world-health:%'
   AND acknowledged_at IS NULL;
