# Task 05 — `agent_delegations` DB schema + migration

## Why

Every API endpoint in this band reads or writes `agent_delegations`. One task owns the schema; all other API tasks assume the shape exists exactly as canonicalized in `00-README.md`.

## Read first

- [00-README.md](./00-README.md) — **Canonical shapes → DB `agent_delegations` table**. Reproduce it exactly.
- [specs/schema/](../../specs/schema/) — existing schema files, style guide (idempotent, documented, indexed)
- [scripts/](../../scripts/) — the existing "apply schema" script pattern (there is a schema-apply script; match its style)
- [api/\_lib/db.js](../../api/_lib/db.js) — how `sql` tagged templates are used (does not matter for this task beyond confirming column naming is snake_case)

## Build this

1. **Create `specs/schema/agent_delegations.sql`** containing:

    - `CREATE TABLE IF NOT EXISTS agent_delegations (...)` with the exact columns from the canonical shape.
    - All three indexes from the canonical shape.
    - A `CHECK` constraint on `status` (`status IN ('active','revoked','expired')`).
    - A `CHECK` on `chain_id > 0`.
    - A `CHECK` ensuring `delegator_address` and `delegate_address` are 42 characters starting with `0x`.
    - A trigger OR a comment explaining that `redemption_count` and `last_redeemed_at` are updated by the redeem endpoint (task 09) — no DB-side trigger needed.
    - Header comment with the spec version (`permissions/0.1`) and the task reference.
    - Fully idempotent: re-running the file against a DB that already has the table is a no-op (use `IF NOT EXISTS` / `DO $$ ... $$` blocks for indexes that already exist).

2. **Create a migration script `scripts/apply-delegations-schema.js`** following the pattern of any existing schema-apply script in `scripts/` (grep for `apply` or `schema`):

    - Reads `specs/schema/agent_delegations.sql`.
    - Uses `DATABASE_URL` from env (same env var the rest of the project uses).
    - Executes the SQL, prints a summary (row count of `agent_delegations` after apply, index list).
    - Exits non-zero on any SQL error.

3. **Run the migration** against the Neon dev branch (env var `DATABASE_URL` points to it locally, via `.env.local` — use `node -r dotenv/config scripts/apply-delegations-schema.js` or the repo's existing pattern). Paste the output in the reporting block. If you do not have DB credentials available, stop and say so explicitly — **do not fake the output.**

4. **Document the table** in `specs/schema/README.md` (append a short row if the file exists; create it if not). One sentence per column.

## Don't do this

- Do not alter other tables. If you think `agents` needs a column (`has_permissions`, a count cache, etc.), note it in your report — don't add it.
- Do not use `UUID` generation that depends on `uuid-ossp` unless the rest of the schema uses it; prefer `gen_random_uuid()` (pgcrypto) — check what sibling `.sql` files use.
- Do not add FK cascades beyond `agents(id) ON DELETE CASCADE`. Revocations and expirations are status changes, not deletes.
- Do not embed example `INSERT` statements in the production schema file. Fixtures belong in `scripts/seed-*.js`.

## Acceptance

- [ ] `specs/schema/agent_delegations.sql` matches canonical shape byte-for-byte on columns and indexes.
- [ ] `scripts/apply-delegations-schema.js` exists and is idempotent.
- [ ] Migration applied against dev DB; `\d agent_delegations` output captured.
- [ ] `specs/schema/README.md` updated.
- [ ] `node --check scripts/apply-delegations-schema.js` passes.

## Reporting

- Full `\d+ agent_delegations` output post-migration.
- `EXPLAIN` output of `SELECT * FROM agent_delegations WHERE agent_id = $1 AND status = 'active'` confirming index use.
- If DB access unavailable, say so and paste only the SQL file contents.
