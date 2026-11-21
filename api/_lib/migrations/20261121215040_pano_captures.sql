-- 360 capture jobs: equirect video, equirect photo sets and raw .insv/.insp
-- footage turned into a Gaussian splat by workers/model-pano2splat
-- (api/pano-capture.js, api/_lib/pano-capture.js, docs/pano-capture.md).
--
-- A splat job runs 10 to 40 minutes on a GPU and its owner closes the tab, so
-- the job lives here, not in the request. Every GET of an active job polls the
-- worker at most once per 5 seconds (polled_at is the throttle) and
-- /api/cron/pano-captures advances any job nobody is watching. When the worker
-- reports success the finaliser streams its files into our own bucket under
-- captures/pano/<user_id>/<id>/, because the worker's signed URLs expire after
-- 7 days. lease_until keeps two finalisers off one job.
--
-- active_slot enforces "at most 2 active jobs per account" without a
-- transaction: a new job takes slot 1 or 2, and the partial unique index
-- refuses a third while two are queued or running. A finished job keeps its
-- slot number, but the index no longer covers it.
--
-- worker_result holds the worker's signed URLs between "worker succeeded" and
-- "files copied"; result holds the durable URLs callers see.

CREATE TABLE IF NOT EXISTS pano_captures (
	id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	status           text NOT NULL DEFAULT 'queued'
	                 CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	stage            text,
	progress         real NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
	source_kind      text NOT NULL
	                 CHECK (source_kind IN ('equirect_video', 'equirect_images', 'insv', 'insp')),
	source_url       text NOT NULL,
	source_urls      jsonb,
	"trim"           jsonb,
	quality          text NOT NULL DEFAULT 'standard'
	                 CHECK (quality IN ('preview', 'standard', 'high')),
	active_slot      smallint NOT NULL CHECK (active_slot IN (1, 2)),
	worker_task_id   text,
	worker_result    jsonb,
	result           jsonb,
	error            jsonb,
	stats            jsonb,
	polled_at        timestamptz,
	lease_until      timestamptz,
	created_at       timestamptz NOT NULL DEFAULT now(),
	updated_at       timestamptz NOT NULL DEFAULT now(),
	finished_at      timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS pano_captures_active_slot
	ON pano_captures (user_id, active_slot)
	WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS pano_captures_user_created
	ON pano_captures (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pano_captures_active
	ON pano_captures (status, polled_at)
	WHERE status IN ('queued', 'running');
