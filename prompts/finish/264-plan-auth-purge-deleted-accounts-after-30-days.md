# Deleted accounts are permanently purged after 30 days, as the privacy policy promises

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/264-plan-auth-purge-deleted-accounts-after-30-days.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 74 of 100 inside the tier). **Area:** auth. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

The public privacy policy (`public/legal/privacy.html`, section 5) tells every user: "Deleted accounts are soft-deleted for 30 days (for recovery), then permanently purged." Nothing performs the purge. `DELETE /api/auth/me` (`handleDeleteAccount` in `api/auth/[action].js`) soft-deletes the `users` row, stamps `deleted_at` on avatars, agent identities and widgets, revokes credentials, and stops there. No cron touches soft-deleted users, so personal data (email, wallet address, profile fields, content, R2 objects) lives forever. That is a broken legal promise (GDPR/CCPA erasure) and an App Store guideline 5.1.1(v) review risk named in `ios/docs/REVIEW-RISK.md`. The right fix is a real, bounded, idempotent purge job, not rewording the policy to describe a tombstone.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `api/auth/[action].js` `handleDeleteAccount`: soft delete only. Sets `users.deleted_at`, nulls `username`, keeps `email` so wallet/SSO login paths can answer `account_deleted` (see `api/auth/siws/[action].js`, `siwe`, `saml`, `x`, `telegram`, `google`, `privy/verify.js`).
- `grep -rnE "deleted_at\s*<" api scripts` finds no job that hard-deletes users. `api/cron/db-retention.js` (scheduled `*/15 * * * *` in `vercel.json`) prunes pump intel, regen jobs, home action log and MCP sessions, never `users`.
- The schema has about 203 `references users(id) on delete cascade`, 55 `on delete set null`, and 33 plain `references users(id)` FKs (migrations in `api/_lib/migrations/`, base in `api/_lib/schema.sql`). Plain FKs will block a hard delete and must each get an explicit decision.
- `legal_signatures.user_id` (migration `20260917180000_legal_signatures.sql`) has no FK, so those rows survive a user delete. The policy says legal acceptance records are retained after deletion; keep it that way.
- Object storage helpers exist in `api/_lib/r2.js` (`deleteObject`, `listObjectsPage`, `keyFromPublicUrl`).
- No test covers account purge (`ls tests/api | grep -i purge` is empty).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
grep -rnE "purge|hard.?delete" api/cron/*.js | grep -i "user\|account" | head
grep -n "deleted_at" "api/auth/[action].js" | head -20
grep -c "" public/legal/privacy.html && grep -n "permanently purged" public/legal/privacy.html
npm run db:status
# every FK that points at users, with its delete rule
grep -rhoE "references users ?\(id\)( on delete (cascade|set null|restrict|no action))?" api/_lib/migrations api/_lib/schema.sql | sort | uniq -c
ls tests/api | grep -i "purge\|delete-account"
```

If a purge job already exists and is scheduled, verify it against the Definition of done and fix only the gaps.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Inventory every table with a column referencing `users(id)` (query `information_schema` / `pg_constraint` against the live DB read-only via `npm run db:` helpers, and cross-check the migrations). Also list tables that carry a user id WITHOUT an FK (`legal_signatures`, audit and x402 tables, wallet-keyed tables). Write the classification into a short comment block at the top of the new module: `cascade` (dies with the user row), `set null` (anonymized by the DB), `blocking` (plain FK), `retain` (financial records, security audit log within its 365 day window, `legal_signatures`).
2. Write the failing tests first in `tests/api/purge-deleted-accounts.test.js` (use the repo's existing DB test harness pattern from the nearest `tests/api/*.test.js`): (a) a user soft-deleted 31 days ago is hard-deleted along with their avatars, agent identities, widgets, sessions and wallet links; (b) a user soft-deleted 29 days ago is untouched; (c) an active user is untouched; (d) `legal_signatures` rows for the purged user remain; (e) a financial/retained table row keeps existing and no longer exposes the email or wallet of the purged user; (f) running the purge twice is a no-op; (g) one user failing mid-purge does not stop the batch and is retried next tick. Run them and confirm they fail because no purge exists.
3. Implement `api/_lib/account-purge.js`: `purgeDeletedAccounts({ olderThanDays = 30, limit = 25 })`. Per user, inside a transaction where the driver allows it: collect and delete R2 objects for the user's avatars, thumbnails, uploads and widget assets (use the storage keys stored on those rows) BEFORE deleting rows, then delete or anonymize dependents per the task 1 classification (plain-FK tables: delete, or `update ... set user_id = null` when the row must be retained for legal or accounting reasons), then delete the `users` row. Keep a minimal non-identifying purge receipt (`account_purge_log`: purged user id hash, counts, timestamp) via a new migration; the receipt must hold no email, wallet or username.
4. Add the migration under `api/_lib/migrations/` (follow the newest filename convention). Read `npm run db:status` first and apply only with `npm run db:migrate` (it applies immediately with no dry run).
5. Add `api/cron/purge-deleted-accounts.js` (authenticate like the sibling crons, bounded batch, idempotent, returns counts and per-user failures without PII) and register it in `vercel.json` `crons` (daily is enough) so `scripts/create-gcp-scheduler.mjs` syncs it. Route it the same way the other cron files are routed in `vercel.json`.
6. Make the sign-in paths consistent: once a user is purged, a returning wallet or SSO subject creates a fresh account (the row is gone), while within the 30 day window they still get `account_deleted`. Add a test that proves both sides for the SIWS path.
7. Update `public/legal/privacy.html` section 5 only if the implemented behavior differs from its text (for example name what is retained: legal acceptance records and financial records). Keep the i18n keys (`data-i18n`) consistent with the locale files the repo uses for that page.
8. Update `ios/docs/REVIEW-RISK.md` to say the purge exists (remove the "no job does that purge today" paragraph) and add a note to `docs/` (the account deletion section of the nearest privacy or data-retention doc) with the retained-data list.
9. Run the purge once in dry-run mode against production data via a read-only count query and report how many accounts are past the 30 day mark (do not delete in production; the deploy gate applies).

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/api/purge-deleted-accounts.test.js` passes and the same tests failed before the implementation.
- [ ] `grep -n "purge-deleted-accounts" vercel.json` shows both the route and the cron entry.
- [ ] A purged user's email and wallet address no longer appear anywhere in the database except tables explicitly classified `retain`, and those hold no direct identifier (verified by the test in task 2e).
- [ ] `legal_signatures` rows survive a purge (test 2d).
- [ ] R2 objects belonging to a purged user are deleted (test with the storage helper stubbed at its boundary only, plus one real list-after-delete check in a dev bucket if credentials are available).
- [ ] The cron response contains no email, wallet or username.
- [ ] `public/legal/privacy.html` section 5 and the implemented behavior agree line by line.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A plain `references users(id)` FK blocks the delete | Decide per table: delete the rows if they are the user's own data, null the column if the row is a retained financial or audit record, and record the decision in the module header. Never drop the FK constraint to get past it. |
| Cannot tell which R2 key a row owns | Read the insert path for that table in `api/` (grep the table name) and use the stored key or `keyFromPublicUrl`; if a table stores no key, derive the prefix from the upload handler. |
| Neon HTTP driver has no multi-statement transaction | Use the repo's existing transaction helper (grep `sql.transaction` / `withTx` in `api/_lib/db.js`); where none fits, order operations content-first, user row last, so a mid-run failure leaves the account purgeable on the next tick. |
| Storage pressure gate (`requireWriteCapacity`) skips the cron | Treat deletes as allowed under pressure; do not gate the purge on write capacity. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/264-plan-auth-purge-deleted-accounts-after-30-days.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `264-plan-auth-purge-deleted-accounts-after-30-days.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

Code and config the reviewer cited alongside these docs (read them in the repo; they are not copied here): `api/cron/db-retention.js`.

### `ios/docs/REVIEW-RISK.md` (section "3. Guideline 5.1.1: permissions and account deletion.")

~~~~markdown
## 3. Guideline 5.1.1: permissions and account deletion.

- Every usage string in `Info.plist` says what the data is for in the user's
  terms. Requesting a permission the app never uses is itself a rejection, so
  do not add usage strings speculatively.
- **Account deletion is reachable in-app.** `/settings`, Danger Zone tab,
  **Delete my account**, confirmed by typing the phrase (`DELETE /api/auth/me`).
  From the user's side it is final: every avatar, agent and widget is taken
  down, the handle is released, every session and refresh token is revoked,
  household access is removed, and no sign-in path (password, wallet, SSO)
  will open the account again. The user row itself is kept as a tombstone with
  its email, so a wallet or SSO sign-in answers `account_deleted` instead of
  quietly creating a fresh account for the same person. Guideline 5.1.1(v)
  allows keeping data for a stated reason. The privacy policy
  (`/legal/privacy`, section 5) promises deleted accounts are purged after 30
  days, and no job does that purge today (`api/cron/db-retention.js` does not
  touch `users`). Close that gap before submitting, either with a purge job or
  by rewording section 5 to describe the tombstone, because a policy that
  promises a deletion the system never performs is the finding to avoid.
  Reviewers test deletion by hand; walk it on the review build with a
  throwaway account.
- **Sign in with Apple (guideline 4.8).** The login page offers GitHub and X
  next to three.ws's own email sign-in. 4.8 asks an app that uses a third-party
  login to also offer one that limits collection to name and email, lets the
  user keep their email private, and does no ad tracking. three.ws's own email
  account is the equivalent we point to: it asks for an email and a password
  and nothing else, and three.ws does no ad tracking. If a reviewer reads email
  sign-in as not meeting the "keep your email private" part, the remedy is
  adding Sign in with Apple to `/login`, which needs a Services ID from the
  same Developer account and is a small, contained change.
~~~~

