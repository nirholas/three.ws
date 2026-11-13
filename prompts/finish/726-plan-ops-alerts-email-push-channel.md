# Ops alerts get an email push channel next to Telegram, with severity routing and a delivery self-test

**Status (2026-11-13, re-verified: 25 tests pass, self-test exits 0; the code is now live in production):** `/api/healthz` reports `alerts.channels` `{dashboard: true, telegram: false, email: false}` and subsystem `alerts_push` is `degraded` with `missing: [OPS_ALERT_EMAILS, TELEGRAM_ALERTS_CHAT_ID]`. Remaining, owner only: choose the recipient address and run `gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --update-env-vars OPS_ALERT_EMAILS=<address>` (config-only), then confirm `alerts_push` is `ok` in `/api/healthz` and delete this order.

**Status (2026-11-12, re-verified again: 25 tests pass, self-test exits 0; nothing left for agents):** Owner action only. Previous status follows. **Status (2026-11-10):** All code, tests, docs and the changelog entry shipped earlier in 34e039010 and ddab2cfca (email channel, hourly warn digest, alertChannels(), alerts_push subsystem, scripts/alerts-self-test.mjs, tests/ops-alerts-push.test.js, docs). Re-verified today: both alert test files pass (25 tests), check:rules clean, self-test exits 0 and reports channels. Remaining, owner: set `OPS_ALERT_EMAILS` (config-only `gcloud run services update --update-env-vars`) and ship the already committed code (`git push threews main`, `npm run deploy:gcp:full`), then confirm `alerts_push` is `ok` in `/api/healthz`; production healthz does not list the new channel states yet because it is not deployed.

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/726-plan-ops-alerts-email-push-channel.md`.

**Priority:** P2, new capability with clear value (score 54 of 100 inside the tier). **Area:** ops. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`sendOpsAlert()` in `api/_lib/alerts.js` always writes to the `ops_alerts` table but only pushes to Telegram when both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALERTS_CHAT_ID` are set. With no push channel configured, an outage that the sweep detects (x402 settle floor, wallet starvation, RPC exhaustion, the sniper out of capital) sits in a dashboard nobody is watching. Resend email is already configured on the platform (`/api/healthz` reports `"resend":"configured"`, helper in `api/_lib/email.js`) but alerts do not use it, so a second, independent push path costs no new vendor.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `api/_lib/alerts.js`: dashboard sink always on; Telegram push is dedup'd for 1 hour per signature and capped at 20 per hour globally; severity from `severityOf(title)` (`critical|warn|info`).
- `alertsConfigured()` reports only the Telegram channel; healthz exposes it.
- `api/_lib/email.js` exports `sendEmail({ to, subject, html, text })`.
- Tests: `tests/ops-alerts-persist.test.js` covers persistence only. No push channel tests.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```sh
grep -n "export\|config()\|post(" api/_lib/alerts.js | head -30
grep -rn "alertsConfigured" api | head
curl -s https://three.ws/api/healthz | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('resend'),d.get('alerts'))"
sed -n 1,57p api/_lib/email.js
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Add an email channel to `sendOpsAlert`: recipients from `OPS_ALERT_EMAILS` (comma separated). Reuse the existing dedup and global hourly limit, but keep separate counters per channel so a Telegram throttle does not silence email. Route by severity: `critical` always pushes, `warn` pushes once per dedup window, `info` stays dashboard-only.
2. Send one digest email per hour for deduplicated warn alerts instead of one email each, with counts and the oldest unresolved item.
3. Extend `alertsConfigured()` into `alertChannels()` returning `{ dashboard: true, telegram: bool, email: bool }` and surface it in `/api/healthz` (keep the old boolean for compatibility). A subsystem `alerts_push` is `degraded` when neither push channel is configured, with a detail telling the owner exactly which env vars to set.
4. Add `scripts/alerts-self-test.mjs`: sends a clearly labelled test alert through every configured channel and prints which delivered. Never run it against production without the labelled test title.
5. Tests first in `tests/ops-alerts-push.test.js` with injected transports: critical goes to both channels, warn dedups, hourly limit per channel is independent, a transport throwing never breaks the caller, digest groups correctly.
6. Docs: add the env vars to `docs/ops/README.md` and the alerts section of `docs/ops/production-log-triage.md`; changelog entry.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npm test -- tests/ops-alerts-push.test.js tests/ops-alerts-persist.test.js` passes.
- [ ] `curl -s https://three.ws/api/healthz` (after deploy) lists channel states and `alerts_push` is `ok` once `OPS_ALERT_EMAILS` or Telegram is set.
- [ ] `node --env-file=.env scripts/alerts-self-test.mjs` exits 0 and reports each configured channel.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No `OPS_ALERT_EMAILS` value exists | Ship with the channel disabled when the variable is unset and let the `alerts_push` healthz detail name the exact env var to set; the owner supplies the address with a config-only `gcloud run services update --update-env-vars`. |
| Resend quota or domain questions | Use the existing sender in `api/_lib/email.js`; do not add a vendor. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/726-plan-ops-alerts-email-push-channel.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `726-plan-ops-alerts-email-push-channel.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `docs/ops/ISSUES.md`
- `docs/ops/production-log-triage.md`
- `docs/ops/redis.md`
