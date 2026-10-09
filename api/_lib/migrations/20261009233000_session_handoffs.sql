-- Migration: single-use codes that carry a signed-in session from the iOS app
-- into Safari.
-- Apply: node scripts/apply-migrations.mjs --apply --file 20261009233000_session_handoffs.sql
-- Idempotent.
--
-- The iOS app sends payments, token launches and trading out to Safari (App
-- Review guidelines 3.1.1 and 3.1.5, ios/docs/REVIEW-RISK.md). Safari has its own
-- cookie jar, so without a handoff the visitor would arrive signed out on a page
-- that exists to spend their money. The app's WebView, which holds the session
-- cookie, asks api/auth/handoff.js for a code; Safari opens
-- /api/auth/handoff?code=... and the code is exchanged for a fresh session
-- there, exactly once, within a minute.
--
--   code_hash    sha256 of the code. The plaintext only ever exists in the URL
--                handed to Safari, so a read of this table cannot be replayed.
--   next_path    the same-origin path the visitor lands on after the exchange,
--                validated when the code is minted.
--   consumed_at  set by the exchange in the same statement that checks it, so
--                two concurrent opens of one URL cannot both get a session.
--
-- Rows are tiny and expire in sixty seconds; the exchange deletes anything more
-- than a day old as it goes, so the table never grows past a day of handoffs.

create table if not exists session_handoffs (
	code_hash    text        primary key,
	user_id      uuid        not null references users(id) on delete cascade,
	next_path    text        not null check (left(next_path, 1) = '/' and left(next_path, 2) <> '//'),
	created_at   timestamptz not null default now(),
	expires_at   timestamptz not null,
	consumed_at  timestamptz
);

create index if not exists session_handoffs_created_at_idx on session_handoffs (created_at);
