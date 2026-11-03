# A paid agent-skill call whose response was lost replays the stored result instead of asking the buyer to pay again

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/284-plan-x402-skill-invoke-idempotent-replay.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 52 of 100 inside the tier). **Area:** x402. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

On `POST /api/agents/x402/invoke` a buyer pays on chain, receives an `intent_id`, and retries with `x-payment-intent`. The intent is consumed before the skill runs. If the skill succeeds but the HTTP response never reaches the buyer (timeout, dropped connection, mobile network), the natural retry with the same intent finds the intent `consumed`, `verifyPaid` returns null, and the route answers a fresh 402. The buyer has paid and been charged once, has no result, and is told to pay again. `docs/x402.md` documents the gap in one line: the `Idempotency-Key` header is "Not yet enforced server-side". The shared idempotency store already exists (`api/_lib/idempotency.js`, `runOnce`) and is used by other money-adjacent routes.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `api/agents/x402/[action].js` `handleInvoke` (about lines 79-296): `verifyPaid` (from `api/_lib/x402.js`) then `consumeIntent` (atomic `paid` to `consumed`) then `executeSkill`; on a throw it calls `releaseIntent`. Revenue is inserted into `agent_revenue_events` with `on conflict (intent_id) do nothing`.
- A repeat call after success cannot pass `verifyPaid` (status is no longer `paid`) and falls to `emit402`.
- `api/_lib/idempotency.js` exports `runOnce({ caller, key, fingerprint, run, shouldStore, toStored, revalidate })` returning `fresh | replayed | conflict | in_progress`, 24 h TTL, plus `normalizeIdempotencyKey` and `argsDigest`.
- No test currently covers invoke replay (`ls tests | grep -i x402` shows no `agents-x402-invoke` test).
- Other paid routes already handle this with the `payment-identifier` extension and per-route stores (for example `api/x402/forge.js` returns the same job for a retried payment).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n -i "idempot" "api/agents/x402/[action].js" api/_lib/x402.js
sed -n 79,120p "api/agents/x402/[action].js"
grep -n "runOnce" -r api --include=*.js -l | head
ls tests | grep -i -E "agents-x402|x402-invoke|x402-skill|x402-intent"
```

If `handleInvoke` already replays a consumed intent's stored result, only add the missing tests and docs.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first. Add `tests/agents-x402-invoke-replay.test.js` modeled on the existing agent-payment tests (`tests/agent-trade-x402.test.js` for the harness style). Cases: (a) pay once, invoke once, simulate a lost response, retry the identical request with the same `x-payment-intent`: expect HTTP 200 with the same body and `replayed: true`, the skill handler executed exactly once, exactly one `agent_revenue_events` row; (b) same intent with a different `args` body: expect 409 `idempotency_conflict`, not a replay; (c) the replay is only served to the same payer (`payerUserId` binding); another account holding the intent id gets the normal 402/denied; (d) concurrent duplicate requests: one runs, the other gets `in_progress` (409 with retry hint) and then the replay. Run it and confirm (a) fails with a 402 today.
2. Implement the replay in `handleInvoke`: derive the idempotency key from the intent id (always) and from an `Idempotency-Key` header when sent (header wins if present; reject keys over `IDEMPOTENCY_KEY_MAX`), fingerprint = `argsDigest` of `{agent_id, skill, args}`, caller = the authenticated user id. Wrap `consumeIntent` + `executeSkill` + revenue insert in `runOnce`, storing only successful outcomes (`shouldStore`), so a failed call still releases the intent and stays retryable exactly as today.
3. Make the manifest honest: add `idempotency: { header: 'Idempotency-Key', ttl_seconds: 86400, replay_field: 'replayed' }` to the `GET /api/agents/x402/manifest` response and to `emit402` so buyers (including `src/onchain/x402/client.js` `x402Fetch`) can rely on it.
4. Teach the browser client: in `src/onchain/x402/client.js` generate one `Idempotency-Key` per logical call and reuse it on the single retry; on a network error after payment, retry once with the same key before surfacing an error. Add a client unit test `tests/onchain-x402-client-idempotency.test.js` (no client test exists today).
5. Update `docs/x402.md`: replace "Not yet enforced server-side" with the real behavior, the replay field, and the TTL. Add a `data/changelog.json` entry and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/agents-x402-invoke-replay.test.js` fails on the first case before the change and passes after, with all four cases green.
- [ ] A lost-response retry returns 200 with `replayed: true` and creates no second `agent_revenue_events` row (asserted in the test).
- [ ] The manifest response contains the `idempotency` block (asserted in the test).
- [ ] `grep -n "Not yet enforced" docs/x402.md` returns nothing.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No local Postgres or Redis for the test | Use the in-memory cache fallback in `api/_lib/cache.js` and the repo's existing test DB helpers; do not mock `runOnce` itself. |
| Unsure whether to key on intent id or header | Both: the intent id is the always-on key, the header lets SDKs choose their own; document that the header wins. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/284-plan-x402-skill-invoke-idempotent-replay.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `284-plan-x402-skill-invoke-idempotent-replay.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/x402.md` (section "Single-shot semantics")

~~~~markdown
## Single-shot semantics

A paid intent is consumed on first successful call: the `paid` to `consumed`
transition is the single-use lock, so two concurrent calls with one intent
cannot both run. If the skill then fails, the intent flips back to `paid`
(`releaseIntent`), so retrying with the same `x-payment-intent` works and the
buyer is not charged for a call that never delivered.

For idempotency (don't double-charge on network retry), pass an
`Idempotency-Key` header - implementations are free to dedupe before
consuming the intent. Not yet enforced server-side.
~~~~

### `docs/x402.md` (section "A paid call that fails never asks the buyer to pay twice")

~~~~markdown
## A paid call that fails never asks the buyer to pay twice

The paid HTTP routes under `/api/x402/*` run the work before settling, so a
handler that fails charges nothing. Two cases remain where the payment has
already settled when something goes wrong: a streaming route (which settles
first so the body can stream) whose handler throws, and a failure recording the
wallet's Sign-In-With-X grant. For both, the response says so and the same
payment can be reused:

```json
{
  "error": "internal_error",
  "paid": true,
  "retry_safe": true,
  "settlement": { "transaction": "5Kd...", "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" },
  "retries_left": 3,
  "retry_until": "2026-10-10T03:00:00.000Z",
  "message": "You were charged; repeat this exact request with the same payment to get your result."
}
```

What a buyer's client should do:

- `paid: true` means the settlement transaction landed. Never build a second payment for this request.
- `retry_safe: true`: repeat the exact request with the same `X-PAYMENT` (or `PAYMENT-SIGNATURE`) header. The server skips verify and settle, re-runs the work, and answers with the original `x-payment-response` header. A body that differs from the original is a different request, so resend it unchanged.
- `retry_safe: false`: the proof used up its retries (`X402_PAID_RETRY_MAX`, default 3) or the window closed (`X402_PAID_RETRY_WINDOW_SECONDS`, default 24 hours). The next attempt answers 409 `payment_retries_exhausted`. Contact support with `settlement.transaction`.
- A call that completed is different: replaying its proof answers 409 `payment_replayed`, and buying the result again needs a new payment.

When a request carries a `payment-identifier`, the idempotency hash covers the HTTP method, URL and request body, so two different POST bodies under one identifier never share a cached response.
~~~~

