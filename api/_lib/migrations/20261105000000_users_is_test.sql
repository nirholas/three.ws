-- Mark QA, audit and end-to-end accounts so public boards can leave them out.
--
-- Automated sweeps (scripts/provision-audit-account.mjs, the API audits, the
-- home and companion e2e runs) sign up real accounts on production and publish
-- real agents and creations with them. Those rows were showing on /characters
-- and /rankings as if they were creators ("QA devnet squad Trader", "Test
-- Agent"). `users.is_test` is the explicit marker the public feeds filter on
-- (api/characters.js, api/leaderboard/unified.js); the accounts keep working
-- exactly as before, they are only hidden from public listings.
--
-- The address rule is mirrored in api/_lib/test-accounts.js (TEST_ACCOUNT_EMAIL_RE)
-- and covered by tests/test-accounts.test.js; change both together. It matches
-- only the prefixes and domains our own tooling generates, never a free-form
-- word like "test" inside a real person's address.
--
-- A BEFORE INSERT trigger applies the same rule to new signups, so the next QA
-- account a sweep provisions is hidden from its first request. An operator can
-- still flip the flag by hand on any account in either direction.
--
-- Reverse: DROP TRIGGER users_mark_test_account ON users;
--          DROP FUNCTION users_mark_test_account();
--          ALTER TABLE users DROP COLUMN is_test;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION users_is_test_email(addr text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
	SELECT coalesce(
		addr ~* '^(qa[-_.]|threews-qa-|qaswarm|api-?audit|apiaudit|audit-batch|anim-audit-|labor-audit-|forgeaudit|auditprobe|[a-z]+-e2e-)'
		OR addr ~* '@(qa\.three\.ws|[^@]*\.test)$',
		false
	)
$$;

CREATE OR REPLACE FUNCTION users_mark_test_account() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF users_is_test_email(NEW.email) THEN
		NEW.is_test := true;
	END IF;
	RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS users_mark_test_account ON users;
CREATE TRIGGER users_mark_test_account
	BEFORE INSERT ON users
	FOR EACH ROW EXECUTE FUNCTION users_mark_test_account();

UPDATE users SET is_test = true WHERE is_test = false AND users_is_test_email(email);

CREATE INDEX IF NOT EXISTS users_is_test_idx ON users (id) WHERE is_test;
