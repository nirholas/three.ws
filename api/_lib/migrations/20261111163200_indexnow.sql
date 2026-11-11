-- IndexNow pipeline (api/_lib/indexnow-queue.js, docs/ops/bing-and-indexnow.md).
--
-- indexnow_urls is the outbox. Every create, update or delete of a public
-- resource upserts its canonical URL here, so ten edits to one agent in a
-- minute collapse into one row. The drain (api/cron/indexnow-reconcile.js)
-- posts pending rows to api.indexnow.org in batches of up to 10,000 and stamps
-- submitted_at. A row is pending while enqueued_at is newer than its last
-- submission; a URL already submitted in the last 24 hours waits out that
-- floor unless the change is a delete, so a busy page is never re-announced
-- on every edit. A row stays after submission: it is the record that the URL
-- was announced, which is what lets a later delete or privacy change be
-- announced too without ever submitting a URL that was never public.
--
-- indexnow_submissions logs every request: how many URLs, the HTTP status,
-- and a sample, so "did Bing get it" is one query.
--
-- indexnow_cursors holds the reconciler's high-water mark per resource type
-- (updated_at, id), so each run scans only rows changed since the last one.

CREATE TABLE IF NOT EXISTS indexnow_urls (
	url           text PRIMARY KEY,
	resource_type text NOT NULL,
	reason        text NOT NULL CHECK (reason IN ('create', 'update', 'delete')),
	source        text NOT NULL,
	enqueued_at   timestamptz NOT NULL DEFAULT now(),
	submitted_at  timestamptz,
	last_status   integer,
	attempts      integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS indexnow_urls_pending
	ON indexnow_urls (enqueued_at)
	WHERE submitted_at IS NULL OR enqueued_at > submitted_at;

CREATE TABLE IF NOT EXISTS indexnow_submissions (
	id           bigserial PRIMARY KEY,
	submitted_at timestamptz NOT NULL DEFAULT now(),
	source       text NOT NULL,
	url_count    integer NOT NULL,
	status       integer,
	ok           boolean NOT NULL,
	error        text,
	sample_urls  text[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS indexnow_submissions_recent ON indexnow_submissions (submitted_at DESC);

CREATE TABLE IF NOT EXISTS indexnow_cursors (
	resource_type text PRIMARY KEY,
	cursor_ts     timestamptz NOT NULL,
	cursor_id     text NOT NULL DEFAULT '',
	updated_at    timestamptz NOT NULL DEFAULT now()
);
