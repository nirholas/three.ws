-- First-copy path: the steps a signed-in user has taken toward their first
-- copy-trade (/first-copy). Only the steps that leave no other durable trace are
-- stored here: 'watch' (opened a verified trade's receipt) and 'ghost' (ran a
-- ghost-copy replay, which is otherwise stateless). The later steps are read
-- live from the tables that already prove them (pump_agent_trades,
-- agent_custody_events, copy_subscriptions), with one exception: a verified
-- self-signed buy of a coin that was not launched on three.ws has no
-- pump_agent_trades row (mint_id is NOT NULL), so buy-confirm records it here
-- as 'trade' with the signature in context.
-- api/_lib/copy-path.js owns reads and writes.

CREATE TABLE IF NOT EXISTS copy_path_progress (
	user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	step         text        NOT NULL CHECK (step IN ('watch', 'ghost', 'trade')),
	context      jsonb,
	completed_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (user_id, step)
);

COMMENT ON TABLE copy_path_progress IS
	'First-copy path steps with no other durable trace. One row per user per step; the first completion wins.';
COMMENT ON COLUMN copy_path_progress.context IS
	'What completed the step: the receipt position id, the ghost-copied leader and result, or the verified buy signature.';
