# grok-startups 08: an xAI credit usage ledger with burn-rate and expiry alerts

Status 2026-11-20: code, tests and docs done. Owner steps remain: apply the production migration, set the XAI_CREDIT_* env vars, create an xAI management key, approve push and deploy. See _context/grok-startups-PROGRESS.md.

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `grok-startups-` order, so it can run in parallel with all of them. Dev port: 3278.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/grok-startups-00-CONTEXT.md](_context/grok-startups-00-CONTEXT.md) (facts, wording rules, parallel-run rules, the no-key rule). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, deploy, setting the grant env var, a production migration if the playbook says it needs the owner) into ONE message at the end. Never contact xAI or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building and `changelog-and-docs` before close-out. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The startups credits are one balance across the Grok API, Grok, Grok Build and Grok Bot, released 20% on approval and 80% after onboarding, and **they expire six months after issue**. Unspent credit is lost value; overspent credit means a surprise bill or a dead lane in the middle of a demo. Every other order in this campaign spends from the same balance (images, video, voice, evals, the mention bot). We need one place that knows what each lane spent, how fast we burn, and how many days of credit remain before expiry. There are no admin pages in this repo (owner rule): operator views are local CLIs.

## Step 0: re-derive the current state

    sed -n 1,120p api/_lib/usage.js
    cat api/_lib/migrations/20260605120000_usage_events.sql
    grep -rn "client_id" api/_lib/usage.js api/_lib/llm.js | head -20
    grep -rln "api.x.ai" api scripts | head -20
    ls scripts/*usage* scripts/*credit* 2>/dev/null
    npm run db:status 2>&1 | tail -15
    gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format=json | grep -c GROK_API_KEY

Then read docs.x.ai for (a) the usage object every API response returns (token counts per type, image and video units, and whether a cost field is included), (b) the published price list per model, and (c) the **management API** (`https://management-api.x.ai` or the documented host): whether it exposes team billing, usage or prepaid balance, which key type it needs, and its endpoint shapes. Record each with its URL. The owner holds the console; never ask them for console screenshots during this session.

## Tasks

1. **Ledger table.** Migration `xai_usage` (fresh UTC timestamp): `id`, `created_at`, `lane` (text: chat, image, video, voice, eval, mention-bot, other), `model`, `request_id`, `input_tokens`, `output_tokens`, `cached_tokens`, `reasoning_tokens`, `units` (images or seconds), `cost_usd_micro` (bigint), `cost_source` (`api` when xAI reported cost, `price_table` when computed), `account_id` nullable, `meta` jsonb. Indexes on `created_at` and `(lane, created_at)`. Follow the database row of the self-unblock playbook; run `db:status` before `db:migrate`. Prove the migration on `scripts/lib/isolated-db.mjs` first.
2. **Price table in one place.** `api/_lib/xai-pricing.js`: per-model prices from the docs with the source URL and the date read, keyed by the ids in `api/_lib/chat-models.js` (read them from there; never type a model id). A test fails if a model in `GROK_MODELS` (and any image, video or voice id exported beside it) lacks a price.
3. **One recording function, every xAI call site.** `recordXaiUsage({ lane, model, response, units, accountId })` in `api/_lib/xai-usage.js`, buffered like `usage.js` (never on the request's critical path; a write failure logs and drops, never fails the user call). Wire it into every existing call site that hits `api.x.ai` (step 0 listed them; [api/_lib/llm.js](../../api/_lib/llm.js) and [api/_lib/x-search.js](../../api/_lib/x-search.js) at minimum). Document the function in its header so sibling orders that add lanes call it. Tests cover cost from the API usage object and cost from the price table.
4. **Operator CLI.** `scripts/grok-usage.mjs` (npm script `grok:usage`) with `--prod-env` to read production through the repo's existing pattern (read another `--prod-env` CLI first). Prints spend by lane and model for today, 7 days and 30 days, the daily burn rate, and, when `XAI_CREDIT_GRANT_USD` and `XAI_CREDIT_ISSUED_AT` are set, the remaining credit, the projected exhaustion date and the days until expiry. If the management API exposes billing (step 0), add `--reconcile` comparing our ledger to xAI's numbers and printing the drift.
5. **Grant values stay out of git.** `XAI_CREDIT_GRANT_USD`, `XAI_CREDIT_ISSUED_AT` and the second-tranche date are env vars on Cloud Run only. Add their names (never values) to `api/_lib/env.js` (hot file) and to the env documentation the repo keeps. The owner message holds the exact `gcloud run services update three-ws-api --update-env-vars ...` command with placeholders for the owner to fill.
6. **Alerts.** A health module `api/_lib/xai-credit-health.js` reported in `/api/healthz` subsystems: `ok`, `warn` when projected exhaustion lands before expiry by less than 14 days or when 30 days remain before expiry with more than 40% unspent (credit about to be wasted), `fail` when spend in the last 24 hours exceeds a configurable daily cap. It never prints the grant amount in a public response: healthz shows only the status and day counts. Tests for each state.
7. **Docs.** `docs/ops/xai-credits.md`: what is recorded, the CLI, the env vars, the alert thresholds and how to change them, and the rule that the amount never lands in git. Link it from `docs/ops/gcp-credits-plan.md` if that file has a related-programs section (small anchored edit).

## Definition of done

- [ ] The migration applies on the isolated DB and `npm run db:status` shows it (applied in production only per the playbook's rule; say which).
- [ ] `npx vitest run tests/xai-usage.test.js tests/xai-pricing.test.js tests/xai-credit-health.test.js` passes.
- [ ] Every `api.x.ai` call site found in step 0 records usage (grep evidence in the report).
- [ ] `npm run grok:usage` prints a real report from the isolated DB with rows written by a real code path (a live xAI call that returns 401 writes no cost row; prove recording with a call that succeeds if a key exists, otherwise by running the recorder on the documented response example through the real function).
- [ ] `grep -rnE "XAI_CREDIT_GRANT_USD=[0-9]" .` returns nothing.
- [ ] `npm test` and `npm run audit:docs` pass (unrelated reds named in one line).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No xAI key | Context file, no-key rule. The ledger, prices, CLI and alerts are all independent of the key. |
| The management API needs a management key we do not have | Document the exact endpoint and key type, build `--reconcile` against the documented shape with a unit test on the docs example, and put "create a management key in the console" in the owner message. |
| Production migration rules | Follow the playbook database row exactly. |
| No price published for a model | Mark it `unpriced` in the table, fail the test with a clear message, and pick the documented nearest tier only if xAI states one applies; otherwise record the API's cost field only. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last (setting the grant env vars, deploy, a management key): leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/grok-startups-PROGRESS.md](_context/grok-startups-PROGRESS.md), including the measured number (call sites instrumented, and current 7-day spend if any).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
