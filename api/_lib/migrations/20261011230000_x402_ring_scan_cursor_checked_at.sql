-- 20261011230000_x402_ring_scan_cursor_checked_at.sql
--
-- The x402 ring leak scanner (api/cron/x402-ring-leak-scan.js) only ever wrote a
-- cursor row for a wallet that had at least one on-chain signature, so the
-- ~1,900 registry wallets that have never moved (most of the 2,000-wallet payer
-- pool added 2026-09-22) carry no row at all and the table cannot answer "when
-- was this wallet last checked". `checked_at` is stamped on every scan, zero
-- signatures or not, so rotation coverage and staleness are both visible and
-- queryable without walking the chain again.

ALTER TABLE x402_ring_scan_cursor ADD COLUMN IF NOT EXISTS checked_at timestamptz;

UPDATE x402_ring_scan_cursor SET checked_at = updated_at WHERE checked_at IS NULL;

CREATE INDEX IF NOT EXISTS x402_ring_scan_cursor_checked_at ON x402_ring_scan_cursor (checked_at);
