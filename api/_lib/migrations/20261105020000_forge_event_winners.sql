-- Forge-Off themed events: permanent hall of fame for daily boards and the
-- overall winner (api/cron/forge-off-event-crown.js). One row per
-- (event, board). board_key is 'day-<n>' for a daily board and 'overall' for the
-- event-wide winner. The creation columns are denormalized at crowning time so
-- a winner card still renders if the creation is later discarded. The first
-- crowning wins and is never rewritten (ON CONFLICT DO NOTHING in the cron).

CREATE TABLE IF NOT EXISTS forge_event_winners (
	event_slug          text NOT NULL,
	board_key           text NOT NULL,
	theme               text,
	creation_id         uuid REFERENCES forge_creations(id) ON DELETE SET NULL,
	votes               integer NOT NULL DEFAULT 0,
	prompt              text,
	glb_url             text,
	preview_image_url   text,
	model_category      text,
	crowned_at          timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (event_slug, board_key)
);

CREATE INDEX IF NOT EXISTS idx_forge_event_winners_recent
	ON forge_event_winners (crowned_at DESC);
