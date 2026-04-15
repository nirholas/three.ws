# Task 01 — SIWE schema migration

## Why this exists

We have `users` (email + password) and `agent_identities` (per-agent wallet). We have **no** place to store the fact that a wallet address *is* a user, and no place to store single-use auth nonces. Without both, SIWE sign-in is either impossible (no user mapping) or replayable (no nonce tracking).

## Files you own

- Create: `specs/schema/NNN-siwe-auth.sql` (look in `api/_lib/schema.sql` and `specs/schema/` to find the current highest number; use the next).
- Edit: `api/_lib/schema.sql` — same DDL appended so a fresh bootstrap still works end-to-end.

Do not touch any other migration file.

## Deliverable

### Column additions on `users`

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS wallet_address text,
  ADD COLUMN IF NOT EXISTS wallet_chain_id integer,
  ADD COLUMN IF NOT EXISTS wallet_linked_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS users_wallet_address_unique
  ON users (lower(wallet_address))
  WHERE wallet_address IS NOT NULL;
```

Notes:
- `wallet_address` nullable — existing email users keep working.
- Case-insensitive unique — EIP-55 checksummed and all-lowercase addresses must collide.
- `wallet_chain_id` optional because SIWE can be chain-agnostic; store the chain the user signed on for audit.

### New table `auth_nonces`

```sql
CREATE TABLE IF NOT EXISTS auth_nonces (
  nonce text PRIMARY KEY,
  purpose text NOT NULL,            -- 'siwe-login' | 'siwe-link'
  issued_to text,                   -- wallet address if known at issue time, else null
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_nonces_expires_idx ON auth_nonces (expires_at);
```

Notes:
- `nonce` is 16+ random bytes base64url'd on the server; treat it as an opaque PK.
- `used_at` is set on successful verify — never allow the same nonce twice.
- A nightly cron / lazy cleanup can prune `expires_at < now()` rows; don't build it here.

## Constraints

- Use `CREATE ... IF NOT EXISTS` everywhere so re-running the bootstrap is safe.
- Don't add triggers. Don't add RLS policies unless the rest of the project uses them.
- Don't change column order on `users`; only append.

## Acceptance test

1. `psql` against a throwaway DB: run `api/_lib/schema.sql` fresh → no errors.
2. Run the new migration file on an existing DB (simulate: load `schema.sql` once, then the migration) → idempotent, no errors.
3. `INSERT INTO users (id, email, wallet_address, wallet_chain_id, wallet_linked_at) VALUES (gen_random_uuid(), 'a@b.com', '0xABC...', 8453, now());` succeeds.
4. Attempting to insert a second row with the same address in different case fails the unique constraint.
5. `INSERT INTO auth_nonces (nonce, purpose, expires_at) VALUES ('abc', 'siwe-login', now() + interval '5 minutes');` succeeds.

## Reporting

- Migration file path and full SQL.
- Any existing schema oddities you had to work around.
