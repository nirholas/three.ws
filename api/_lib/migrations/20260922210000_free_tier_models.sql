-- Free-tier model allowance: a daily message budget on the free open models.
--
-- The open-model roster (api/_lib/model-roster.js) marks some models `free`.
-- A message sent on one of them costs the caller nothing, but it draws one unit
-- from a daily allowance so the free lanes behind it (and the Vertex credits
-- tail) cannot be drained by one account. api/_lib/free-tier.js owns both
-- tables' rows; nothing else writes them.
--
--   app_settings['free_tier']  the allowance: messages per UTC day for a
--                              signed-in account and for an anonymous caller
--                              (keyed by IP). Edit the row to change the
--                              allowance; the server re-reads it every minute
--                              and /pricing shows the live numbers.
--   free_tier_usage            one row per (subject, UTC day). `subject` is
--                              'user:<uuid>' or 'ip:<sha256 prefix>'; the raw
--                              IP is never stored. Past days are kept as usage
--                              history (one small row per active caller per
--                              day); free-tier.js prunes rows past 90 days.

CREATE TABLE IF NOT EXISTS app_settings (
	key        text PRIMARY KEY,
	value      jsonb NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings (key, value)
VALUES ('free_tier', '{"daily_messages": 100, "anon_daily_messages": 20}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS free_tier_usage (
	subject     text NOT NULL,
	day         date NOT NULL,
	used        int  NOT NULL DEFAULT 0 CHECK (used >= 0),
	updated_at  timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (subject, day)
);
CREATE INDEX IF NOT EXISTS free_tier_usage_day_idx ON free_tier_usage (day);
