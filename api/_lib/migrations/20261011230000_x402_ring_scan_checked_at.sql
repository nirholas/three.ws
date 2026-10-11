-- x402_ring_scan_cursor.checked_at: when a wallet was last ATTEMPTED, distinct
-- from updated_at which only moves when a cursor actually advances (new
-- signatures found). The ring leak scanner (api/cron/x402-ring-leak-scan.js)
-- walks its registry oldest-checked_at-first so every enabled wallet is
-- guaranteed a scan at least once per rotation even when it has zero activity
-- forever; without a column that moves on a zero-signature run, those wallets
-- would sort to the front on every single run and starve the ones with real
-- cursor advances. api/cron/x402-ring-leak-scan.js ensureSchema() applies the
-- same ALTER idempotently for a fresh database.

ALTER TABLE x402_ring_scan_cursor ADD COLUMN IF NOT EXISTS checked_at timestamptz;

CREATE INDEX IF NOT EXISTS x402_ring_scan_cursor_checked_at
	ON x402_ring_scan_cursor (checked_at NULLS FIRST);

COMMENT ON COLUMN x402_ring_scan_cursor.checked_at IS
	'Last time this wallet was scanned, including zero-signature runs. Drives the oldest-first rotation order.';
