# 433. Fix the account_link_codes table-name collision breaking every phone/desktop/CLI/Telegram account-link call in production

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that references a crypto project other than $THREE, and destroying unrecoverable data. This order writes a new forward migration and a test; it applies the migration to whatever `DATABASE_URL` resolves to locally/in CI the same way every other migration in this repo is applied (`npm run db:migrate`), which is the existing convention, not a new gate. It does not push or deploy.
- Bug fixes are test-first (owner directive 2026-10-10): write the failing test first, confirm it fails for the reason given below (not a typo or setup error), then fix, then confirm it passes, then commit test and fix together.
- No mocks, no fake data, no unfinished-work markers, no commented-out code.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.
- Do not touch `prompts/finish/417-auto-thumbnail-error-fallback.md`, `420-auto-hover-state-regression.md`, or any other open order's files. This order's surface is exactly: one new migration file, `api/_lib/schema.sql` (comment only, see Task 4), `tests/account-link.test.js` (or a new `tests/account-link-codes-schema.test.js` if you decide the live-DB check doesn't belong in the mocked-DB suite, see Task 2), and `data/changelog.json`.

## Why this matters (measured 2026-10-24)

Every call into the phone/desktop/CLI/Telegram account-linking feature
(`/dashboard/account`, and the mobile-app pairing flow it backs) is broken in
production right now, and has been since the feature's migration merged on
2026-10-11. This is not a flaky edge case: it is a 100% failure rate on every
action (`mint`, `claim`, `poll`, `pending`, `decide`, `devices`, `revoke`)
dispatched by `api/auth/link-codes/[action].js`, because every one of them
reads or writes a column that does not exist on the live table.

Root cause, confirmed by direct reproduction against the real database
(`node --env-file=.env.local <script>`, using the repo's own `sql` tag from
`api/_lib/db.js`, 2026-10-24):

    test user id fc893ecf-8313-4be1-9fca-e868a4f73cb5
    THREW: NeonDbError: column "status" does not exist
        at ... listPendingLinkCodes (api/_lib/account-link/link-codes.js:155:15)
      code: '42703',
      routine: 'errorMissingColumn',

and confirmed by reading the live table's actual columns directly:

    select column_name from information_schema.columns where table_name = 'account_link_codes';
    -> id, code_hash, user_id, agent_id, label, scopes, created_at, expires_at, redeemed_at, link_id

Two unrelated features share the table name `account_link_codes`:

1. `api/_lib/migrations/20260922130000_agents_v1_api.sql` (merged 2026-09-22)
   created `account_link_codes` for an agent-identity pairing feature:
   columns `agent_id`, `scopes`, `redeemed_at`, `link_id`. This is the schema
   that is actually live in production today.
2. `api/_lib/migrations/20261011003000_account_linking.sql` (merged
   2026-10-11) created a *different* table, also named `account_link_codes`,
   for the phone/desktop/CLI/Telegram device-linking feature that
   `api/_lib/account-link/link-codes.js` and `api/auth/link-codes/[action].js`
   actually implement: columns `device_kind`, `status`, `claim`,
   `claim_secret_hash`, `result_kind`, `result_id`, `result_secret`,
   `device_id`, `claimed_at`, `decided_at`, `consumed_at`.

Migration 2 used `CREATE TABLE IF NOT EXISTS account_link_codes (...)`. Since
a table of that name already existed from migration 1, this silently no-op'd:
no error, no warning, `npm run db:status` reports "all migrations applied"
(confirmed 2026-10-24: production is current through
`20261024020000_prediction_shadow_ledger.sql` with no drift), and the feature
shipped looking complete while being 100% broken against the real database.

This explains why the bug was never caught by `npm test`:
`tests/account-link.test.js` mocks `api/_lib/db.js` entirely with a scripted
fake (`vi.mock('../api/_lib/db.js', ...)`, see its header comment), so the
unit suite exercises the application logic correctly but never touches the
real schema. `npm run audit:web`'s page audit also cannot see this: the
link-codes dispatcher sits behind session auth
(`getSessionUser`/`sessionOrFail` in every handler) and the unauthenticated
audit never signs in, so it never dispatches a request that would surface the
500.

The old (migration-1) schema is dead code: grepping every `.js`/`.mjs` file
under `api/`, `src/`, `workers/`, `scripts/` for `account_link_codes` finds
exactly one consumer, `api/_lib/account-link/link-codes.js`, and every column
name it references (`status`, `device_kind`, `claim`, `claim_secret_hash`,
`result_kind`, `result_id`, `result_secret`, `device_id`, `claimed_at`,
`decided_at`, `consumed_at`) belongs to the migration-2 (new) schema, never to
migration-1's `agent_id`/`scopes`/`redeemed_at`/`link_id`. Nothing live reads
or writes the old schema's distinguishing columns. The fix is to rename the
old table out of the way (preserving its rows, in case the owner wants to
inspect or port old agent-identity-link data later, satisfying the
"destroying data that cannot be regenerated" gate by not destroying anything)
and let the already-written, already-shipped application code create and use
the correctly-shaped table.

## Step 0: re-derive the current state

    git log --oneline -1
    npm run db:status                                    # confirm "all migrations applied", no drift
    grep -n "account_link_codes" api/_lib/migrations/20260922130000_agents_v1_api.sql
    grep -n "account_link_codes" api/_lib/migrations/20261011003000_account_linking.sql
    grep -rln "account_link_codes" api/ src/ workers/ scripts/ | grep -v node_modules   # confirm the only live consumer is api/_lib/account-link/link-codes.js
    node --env-file=.env.local -e "
      import('./api/_lib/db.js').then(async ({ sql }) => {
        const rows = await sql\`select column_name from information_schema.columns where table_name = 'account_link_codes' order by ordinal_position\`;
        console.log(rows.map(r => r.column_name));
        process.exit(0);
      });
    "
    # expect: [ 'id','code_hash','user_id','agent_id','label','scopes','created_at','expires_at','redeemed_at','link_id' ]
    # (the OLD schema; if this instead already shows 'status'/'device_kind', someone has already
    # fixed this live and you should stop and verify whether this order is already resolved before continuing)

## Tasks

1. Create `api/_lib/migrations/20261024120000_fix_account_link_codes_collision.sql` (pick the current UTC
   timestamp per the repo's migration-naming convention, 14 digits `YYYYMMDDHHMMSS`, if 20261024120000
   is already taken by a concurrent agent's migration). Contents:
   - `ALTER TABLE IF EXISTS account_link_codes RENAME TO account_link_codes_agents_v1_legacy;` plus the
     matching index rename (`account_link_codes_user_idx` -> `account_link_codes_agents_v1_legacy_user_idx`),
     each guarded so the migration is safe if ever re-examined (use `IF EXISTS` on the table rename; Postgres
     has no `ALTER INDEX IF EXISTS ... RENAME` guard issue, `ALTER INDEX IF EXISTS` is valid syntax, use it).
   - Followed by the exact `CREATE TABLE IF NOT EXISTS account_link_codes (...)` and
     `CREATE INDEX IF NOT EXISTS account_link_codes_user_idx ...` statements copied verbatim from
     `api/_lib/migrations/20261011003000_account_linking.sql`, so the table that gets created this time is
     the correctly-shaped one (the rename in the prior statement clears the name collision first).
   - A short comment at the top of the file stating the root cause in one or two lines (not a changelog of
     this work order, just the technical fact for the next person reading migration history): the table name
     collided with the 2026-09-22 agents-v1 link-codes feature, which is preserved under the renamed table.
2. Apply it locally against the real database the repo already points at: `npm run db:migrate`. Confirm
   with `npm run db:status` that it is now applied and there is no drift.
3. Add a regression test. The existing `tests/account-link.test.js` mocks the DB entirely (see "Why this
   matters" above), so it cannot catch a real schema mismatch; adding the assertion there would not have
   caught this bug and will not catch its return. Instead add a new, small test file
   `tests/account-link-codes-schema.test.js` that opens a real connection via `node --env-file=.env.local`
   semantics (read `DATABASE_URL` the same way `scripts/apply-migrations.mjs` does: `.env.local` then `.env`
   then `process.env`; skip the test with a clear console message if no `DATABASE_URL` is resolvable, same
   pattern other DB-touching scripts in this repo use) and:
   - First, reproduce the exact failure this order fixes: write the test so that, run against a database
     that still has the pre-fix table shape, `listPendingLinkCodes` (or a direct
     `select status from account_link_codes limit 0`) throws a Postgres error with `code === '42703'`. Run
     it now (before Task 1/2's migration is applied, or against a scratch check) and confirm it fails for
     that reason, per the test-first rule.
   - Then, after the migration is applied, assert the live table has the new-schema columns
     (`status`, `device_kind`, `claim_secret_hash`, `claimed_at`, `decided_at`, `consumed_at`) and that
     `listPendingLinkCodes(userId)` resolves (empty array for a fresh user) rather than throwing.
   - Also assert `account_link_codes_agents_v1_legacy` exists (`select to_regclass('account_link_codes_agents_v1_legacy')`
     is not null) so a future cleanup pass can find the preserved old data.
4. Update the comment immediately above the `account_link_codes` block in `api/_lib/schema.sql` (around
   line 2695) to match the new (migration-2) column list, since `scripts/db-bootstrap.mjs` applies
   `schema.sql` before migrations and a fresh database should get a schema.sql comment that isn't
   misleading about which feature owns this table name today; do not change the actual `CREATE TABLE`
   statement in `schema.sql` itself (it must keep creating the legacy shape so the migration chain's rename
   step has something to rename on a from-scratch bootstrap, exactly mirroring what happened in production).
5. Run `npx vitest run tests/account-link.test.js tests/account-link-codes-schema.test.js` and confirm both
   files pass.
6. Run `npm run check:rules -- --paths api/_lib/migrations/20261024120000_fix_account_link_codes_collision.sql tests/account-link-codes-schema.test.js api/_lib/schema.sql` (substitute the real migration filename chosen in Task 1).
7. Delete any scratch/diagnostic scripts you create while working this order before committing (repo
   hygiene: no throwaway scripts in the root or in `scripts/` once the order is done).

## Definition of done

- [ ] New migration file exists under `api/_lib/migrations/`, renames the legacy table and index, then
      creates the correctly-shaped `account_link_codes` table and index (verified by re-reading the file).
- [ ] `npm run db:migrate` applied it against the real database and `npm run db:status` reports no pending
      migrations and no drift.
- [ ] `select column_name from information_schema.columns where table_name = 'account_link_codes'` now
      returns the new-schema columns (`status`, `device_kind`, `claim`, `claim_secret_hash`, `result_kind`,
      `result_id`, `result_secret`, `device_id`, `claimed_at`, `decided_at`, `consumed_at`), not the old ones.
- [ ] `select to_regclass('account_link_codes_agents_v1_legacy')` is not null (old data preserved, nothing destroyed).
- [ ] `tests/account-link-codes-schema.test.js` exists, reproduces the original 42703 failure mode in its
      first assertion, and passes end to end after the fix.
- [ ] `npx vitest run tests/account-link.test.js tests/account-link-codes-schema.test.js` exits 0.
- [ ] `npm run check:rules -- --paths <files touched>` exits 0.
- [ ] `api/_lib/schema.sql`'s comment above the `account_link_codes` block is corrected; its `CREATE TABLE`
      statement is unchanged.
- [ ] No scratch files left in the repo root or `scripts/`.
- [ ] One `data/changelog.json` entry (tag `fix`) describing the account-linking fix in terms a user would
      recognize ("fixed phone/desktop/CLI/Telegram account linking, which was failing on every attempt").
- [ ] Commit with explicit paths; subject names the actual fix (e.g.
      `fix(account-link): rename the colliding account_link_codes table so device linking stops throwing 42703`).

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| `npm run db:migrate` applies immediately with no dry run, against what might be the shared production database | This is the documented, existing convention for every migration in this repo (`npm run db:status` confirms current state first); the rename preserves all old rows and the create is `IF NOT EXISTS`, so the operation is safe and reversible by renaming back | Run `npm run db:status` before and after, exactly as every other migration-writing order in this repo does |
| You can't tell whether `account_link_codes_agents_v1_legacy`'s old rows are "important" | They are 10-minute-TTL link codes from a feature that, per the grep in Step 0, no live code path reads; renaming (not dropping) satisfies the no-data-destruction rule regardless | Rename, never drop; note the row count you preserved in the report |
| `tests/account-link.test.js`'s mocked-DB pattern makes it awkward to add a real-DB assertion in the same file | That is exactly why Task 3 creates a separate file instead of extending the mocked suite | Keep the new real-DB test in its own file; do not weaken or remove the existing mock-based tests |
| No `DATABASE_URL` is resolvable in this environment | Every other migration/db script in this repo reads `.env.local` first; if that file is genuinely absent here, that is itself new information worth one line in the report, but check `.env.local` exists (per Step 0, it is present as of 2026-10-24) before concluding that | Read `.env.local`'s presence the same way `scripts/apply-migrations.mjs` does before assuming it's missing |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths.
3. Delete this file in the final commit (`git rm prompts/finish/433-auto-fix-account-link-codes-schema-collision.md`) once every Definition of done line is verified green, and append a dated entry to `prompts/finish/_context/production-100-PROGRESS.md` with the commit SHA. If a line cannot pass, leave the file and say which line remains and why.
4. Final report, in this order: the Step 0 measurements, the migration filename chosen, the before/after column lists, the test output, the commit SHA. No trailing questions.
