# Re-measure the x402 autonomous loop's failure classes against current code and fix every one still above 1 percent

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/267-plan-x402-loop-failure-classes-remeasure-fix.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 74 of 100 inside the tier). **Area:** x402. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The x402 ring and autonomous loop are the platform's only continuously exercised paid rail, and its settle rate drives the revenue readout. Three July 25 task briefs recorded a 69 percent all-time failure rate (dominant `http_502`, plus `http_405` on dance-tip, `http_400` on agent-reputation / telegram-health / llm-proxy, `http_402` with payment attached, zero-success "Ring Tick", `wallet_unconfigured`, `sponsor_sol_floor`, `insufficient_payer_usdc`) and a flapping Redis cache. Commits since then fixed several causes (per-payment nonce, fresh blockhash, empty-payer classification, method guard, dance-tip GET, `server/index.mjs` `keepAliveTimeout` 620s), but the briefs were never closed and no measurement after those fixes is recorded. Without a current measurement nobody knows which classes remain, and the bursts waste loop capacity and pollute stats. Order `902-backlog-01-x402-settle-runway` owns `fee_runway_exhausted`; do not duplicate it.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Loop code: `api/cron/x402-autonomous-loop.js` (751 lines, per-entry `method`, default POST), registry `api/_lib/x402/autonomous-registry.js` (dance-tip entries are marked GET with a comment that POST 405s), ring driver `api/cron/x402-ring-tick.js` (527 lines, per-minute, separate budget), log table `x402_autonomous_log` (columns include `error_msg`, `ts`, `pipeline`).
- Fix commits on `api/cron/x402-autonomous-loop.js`: `674173cff` unique nonce per payment, `80df0c960` fresh blockhash, `44c862279` unreadable sponsor balance, `9a0a13721` empty ring payer reported as `insufficient_payer_usdc`.
- `server/index.mjs` lines 730-731: `headersTimeout = 65_000`, `keepAliveTimeout = 620_000` (above the Google front end's 600 s idle, the usual cure for load-correlated 502s).
- Tests exist: `tests/x402-autonomous-payer-float.test.js`, `tests/x402-ring-tick.test.js`, `tests/x402-ring-tick-exec.test.js`, `tests/x402-ring-floors.test.js`, `tests/x402-ring-fee-floor.test.js`, `tests/x402-ring-pool.test.js`, `tests/x402-ring-wallet-monitor.test.js`.
- `DATABASE_URL` is not in the local `.env`, so the reviewer could not query `x402_autonomous_log`. The post-fix failure distribution is unmeasured.
- The Redis flap (`upstash 500 SRH`) was addressed on the rate limiter by pinning `@upstash/ratelimit` to 2.0.8 (`3b7757330`); the cache layer's state (`api/_lib/cache.js`, `UPSTASH_CACHE_REST_*`) is unverified.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

Get the database URL through the self-unblock playbook (Cloud Run env or Secret Manager; never print it), then:

```bash
cd /home/user/three.ws
node scripts/read-service-env.mjs '^DATABASE_URL' --names          # confirm it resolves
psql "$DATABASE_URL" -c "select case when success then 'ok' else coalesce(error_msg,'failed') end as outcome, count(*) from x402_autonomous_log where ts > now() - interval '48 hours' group by 1 order by 2 desc limit 25;"
psql "$DATABASE_URL" -c "select service_name, count(*) filter (where success) ok, count(*) total from x402_autonomous_log where ts > now() - interval '48 hours' group by 1 order by (count(*) - count(*) filter (where success)) desc limit 25;"
psql "$DATABASE_URL" -c "select pipeline, count(*) filter (where success) ok, count(*) from x402_autonomous_log where ts > now() - interval '7 days' group by 1;"
gcloud run services logs read three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --limit 200 2>&1 | grep -ciE 'redis|SRH'
npm run readout:revenue -- --window 7d
```

Columns: `run_id, ts, endpoint_type, service_name, endpoint_url, amount_atomic, tx_signature, success, error_msg, pipeline` (defined in `api/_lib/migrations/20260629120000_payment_reconciliation.sql` ; confirm with `\d x402_autonomous_log`). Any failure class at or below 1 percent of the 48 hour calls is out of scope; record it and move on. `fee_runway_exhausted` belongs to order 902.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Record the measured distribution in `docs/ops/x402-loop-failure-baseline-<date>.md`: outcome counts, worst services, Ring Tick successes, wallet roster status, Redis health. This is the evidence the rest cites.
2. For each class above 1 percent, find the mechanism, then work test-first: write a test that reproduces the caller/endpoint mismatch against the real handler or registry entry (for example, an assertion that every registry entry's `method`, path and body validate against the live handler's schema, in `tests/x402-autonomous-registry-contract.test.js`), see it fail, fix the caller side. Do not loosen a working endpoint's validation and do not touch the autonomous trading arms.
3. 502s: if they persist after the keep-alive fix, compare Cloud Run request logs to loop timestamps (burst vs instance start), check the Cloud Run request timeout against the handler's longest path, and check for handlers that crash without logging. Fix the mechanism. Add bounded retry with jitter in the loop caller only as defense in depth, and only for idempotent 402-challenge fetches (never retry a signed payment).
4. `http_402` with payment attached: make the loop re-fetch the 402 challenge once on any 402 after payment and never reuse cached requirements across a price change. Cover with a unit test that changes the advertised price between calls.
5. Ring Tick: if it still has zero successes over 7 days, find why (price, route, payer pool, cap) and fix it, or remove it from the roster with a stated reason in a comment-free commit message and the baseline doc.
6. Wallets: for `wallet_unconfigured`, either configure the missing wallet or delete the roster entry. For `sponsor_sol_floor` and `insufficient_payer_usdc`, confirm `api/_lib/economy-rebalance.js` is scheduled and acting (show the ledger row or log line where it acted); fix the trigger if not. Any actual SOL or USDC transfer is an on-chain spend (see Gates).
7. Cache: if Redis/SRH errors are still present, restore the endpoint or point the cache at a working store (Memorystore on the existing VPC connector is pre-approved). The in-memory fallback in `api/_lib/cache.js` must remain.
8. After the fixes ship (owner deploy), re-measure after two full loop windows and append the result to the baseline doc. Until the deploy, report the fixes as prepared with the single deploy command.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `docs/ops/x402-loop-failure-baseline-<date>.md` exists with a pre-fix and a predicted post-fix table, naming every class above 1 percent.
- [ ] Each fixed class has a test observed failing before the fix; `npx vitest run tests/x402-*.test.js` passes.
- [ ] Registry contract test: every entry in `api/_lib/x402/autonomous-registry.js` that is not forge-lane validates its method, path and body against its handler; the test lists any exception with a reason.
- [ ] Zero `wallet_unconfigured` rows would be produced by the current roster (verified by a test over the roster against configured wallet ids).
- [ ] `npm run check:rules -- --paths api/cron api/_lib/x402 tests` is clean.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| `DATABASE_URL` not local | Read it from the Cloud Run service or Secret Manager per `self-unblock-playbook`; use a read-only role if one exists; run only SELECTs. |
| The forge lane rows fail | The forge lane is rebuilt elsewhere; exclude `/api/x402/forge` and report its numbers separately. |
| A fix looks like it changes a working endpoint | Fix the caller side or add a new module; the owner rule from the briefs stands: a working endpoint is frozen. |
| Post-deploy proof needs production | Prepare everything, state the one deploy command (`npm run deploy:gcp:full`), and report that post-deploy re-measurement is the only remaining step. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Moving SOL or USDC between ring wallets (top-up or rebalance) is an on-chain spend. Print recipient, amount, token and chain in one table and ask for an explicit yes once at the end of the session; automated recirculation inside the already approved ring caps is not a new gate. Never print or log private keys.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/267-plan-x402-loop-failure-classes-remeasure-fix.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `267-plan-x402-loop-failure-classes-remeasure-fix.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/agent-tasks/fix-x402-502-bursts.md` (whole file)

~~~~markdown
# Task: Root-cause and fix the x402 autonomous loop 502 bursts

## Context (verified 2026-07-25)

The autonomous x402 buyer loop (user agent `threews-x402-autonomous/1.0`) fails 69% of its calls all-time. The dominant error is `http_502`: 67,770 all-time, 20,030 in the last 48 hours, and it is still happening (last spike 09:00 to 11:00 UTC today at roughly 500 per hour).

Hard data already gathered, do not re-derive it:

- Failure breakdown lives in the `x402_autonomous_log` Neon table (`DATABASE_URL` in `.env`), column `error_msg`. Top offenders last 48h: `http_502` 20,030; `http_405` 3,026; `http_400` 2,798; `sponsor_sol_floor` 2,527; `http_402` 1,911.
- The 502s hit many different `/api/x402/*` endpoints (crypto-intel, analytics, skill-marketplace, spend-session, did, cross-chain, notify, wallet-connect, feed-health, `/api/x402/d/coin/...`, `/api/mcp`), so it is not one broken handler.
- The same endpoints return correct 402 challenges when curled manually outside the burst window, so this is load-correlated, not a hard outage.
- During the 10:00 UTC hour today the loop's own traffic mix on Cloud Run was: 501x 402 (good), 365x 502, 62x 405, 56x 400, 8x 422, 5x 200, 2x 404, 1x 503.
- Cloud Run 502 log entries carry NO textPayload (no app-level error), latencies range 0.3s to 8.6s. Startup probes succeed; no OOM or exit signatures found in the last 48h. A burst of new instance startups happened at 10:40 UTC while 502s were flowing.
- Cloud Run config for `three-ws-api` (region `us-central1`, project `aerial-vehicle-466722-p5`): containerConcurrency 160, minScale 2, maxScale 100, cpu-throttling on, startup-cpu-boost on, VPC connector `three-ws-vpc` with private-ranges-only egress.
- Separate but possibly related: the Redis cache layer is flapping. App logs show repeated `[cache] redis GET/SET failed, using memory fallback: upstash 500 SRH: Unable to connect to the Redis server` and timeout variants. A failing cache makes every request slower and heavier, which can amplify burst saturation.

## Job

1. Find the 502 mechanism. Likely candidates to check, in order: the loop hammering the service through the public LB/CDN in tight bursts and hitting per-instance connection resets; in-process handler crashes that kill in-flight requests without logging; LB backend timeout mismatch (Cloud Run request timeout vs LB timeout); the Node server (`server/index.mjs`) closing keep-alive sockets under load (classic Node keepAliveTimeout < LB idle timeout bug, which produces exactly this signature: intermittent 502s at the LB with no app logs). Check `server/index.mjs` for `keepAliveTimeout` and `headersTimeout` settings; Google Front End reuses connections and needs server keepAliveTimeout above the LB's 600s idle default, or at minimum above 61s. This is the most probable root cause given the evidence.
2. Fix it properly (no retries-as-bandaid; fix the mechanism, then add sane retry with backoff in the loop caller as defense in depth if it does not already exist).
3. Fix the Redis/SRH cache failures too: find where the Upstash/SRH endpoint is configured (Cloud Run env), verify whether the SRH proxy is dead or misconfigured, and either restore it or point the cache at a working Redis (Memorystore on the existing VPC connector is pre-approved GCP spend). Memory fallback must remain as the last resort, not the steady state.
4. Verify: re-run or wait for the next loop cycle and show the 502 count for a full loop window dropping to near zero (`x402_autonomous_log` query by `ts` and Cloud Run request logs). Manual curl checks are not sufficient evidence; the failure only shows under burst load.

## Constraints

- OWNER RULE, overrides everything: do not modify anything that is working today. Free lanes, paid endpoints that settle correctly, the forge, the gallery, all of it is frozen. Only touch provably-broken paths, and prefer additive changes (new module, new config) over edits to shared working code. If a fix seems to require changing a working path, stop and flag it in your report instead of doing it. Server tuning (keep-alive timeouts, cache backend) counts as fixing a broken path only if you first prove the current values are causing the 502s.
- Do NOT touch the autonomous trading bots (the arms described at three.ws/blog/autonomous-trading-experiment). They are out of scope.
- Do not reduce loop volume to make the errors go away; the point is that the platform sustains the load.
- Config-only `gcloud run services update` changes are pre-approved. Use `--update-env-vars`, never `--set-env-vars`.
- A production deploy of code changes needs owner approval: commit locally, prepare the deploy, and state the one command left to run.
- CLAUDE.md rules apply, including: never use em-dash or en-dash characters anywhere, changelog entry only if user-visible, stage explicit paths only.

## Done means

502s from the autonomous loop during a full burst window are near zero, the cache layer reports healthy, the root cause is stated in one paragraph in your report, and tests pass (`npm test`, no `tail` pipe).
~~~~

### `docs/agent-tasks/fix-x402-caller-mismatches.md` (whole file)

~~~~markdown
# Task: Fix x402 autonomous loop caller/endpoint mismatches (405, 400, 422, 402 failures)

## Context (verified 2026-07-25)

The autonomous x402 buyer loop logs its calls to the `x402_autonomous_log` Neon table (`DATABASE_URL` in `.env`). Beyond the 502s (a separate task, `fix-x402-502-bursts.md`, may already be claimed), a steady share of failures are deterministic client-side mismatches. Last 48 hours:

- `http_405` 3,026, almost all on `https://three.ws/api/x402/dance-tip` (2,768). Curling GET and POST on that endpoint both return 402 today, so the loop is sending some other method, a stale path, or hitting a route that redirects and re-requests with the wrong method.
- `http_400` 2,798, concentrated on `/api/x402/forge` (721, EXCLUDED from this task: the forge lane is being rebuilt separately, skip it), `/api/x402/agent-reputation` (573), `/api/x402/telegram-health` (506), `/api/x402/llm-proxy` (506). The loop is paying for calls whose request bodies or params the endpoint rejects. Note "Agent Reputation Leaderboard" has succeeded only 19 times out of 4,648 attempts all-time; it is effectively always broken in the loop config.
- `http_422` 394.
- `http_402` 1,911 spread over `skill-marketplace`, `club-cover`, `billboard`: these are calls where payment was attached but the endpoint still answered 402, meaning the payment header was malformed, the wrong price/asset was paid, or the requirements changed and the loop caches stale requirements.
- Also: the "Ring Tick" service has 10,320 calls, zero successes, zero dollars, all-time. Find what it is supposed to do; fix it if it has a purpose, delete it from the loop roster if it does not. Zero-value calls burn loop capacity and pollute the stats.

## Job

1. Locate the loop's service roster and request construction (search for where `x402_autonomous_log` is inserted and where service names like "Dance Tip Volume", "Agent Reputation Leaderboard", "Ring Tick" are defined).
2. For each failing service, diff what the loop sends (method, path, query, body, payment header) against what the live endpoint handler actually requires. Fix the caller when the caller is wrong, fix the endpoint when the endpoint is wrong (e.g. an endpoint that rejects a valid documented body). Do not loosen endpoint validation just to make the loop pass.
3. For the `http_402`-with-payment cases, check whether the loop caches payment requirements across price changes, and make it re-fetch the 402 challenge on any 402 response before retrying once.
4. Verify each fix with a real paid call end to end (the loop's own wallets and self-facilitator settle path; smallest configured price). Show the tx signature and the successful response for at least one call per fixed service, then confirm in `x402_autonomous_log` after the next loop cycle that the error class is gone.

## Constraints

- OWNER RULE, overrides everything: do not modify anything that is working today. A caller with zero or near-zero successes is broken and fair game; an endpoint that answers correctly to a well-formed request is working and frozen. Fix the broken caller side, never "loosen" or rewrite a working endpoint. Prefer additive changes over edits to shared loop code that working services flow through; if you must touch a shared path, prove behavior is unchanged for the working services in your report.
- Do NOT touch the autonomous trading bots (three.ws/blog/autonomous-trading-experiment). Out of scope.
- Real payments only; no mocked settlement. Per-call prices are the existing configured micro-prices; do not raise prices in this task.
- Production deploy of code changes needs owner approval: commit locally, prepare the deploy, state the one remaining command.
- CLAUDE.md rules apply, including: never use em-dash or en-dash characters anywhere; stage explicit paths only, never `git add -A`.

## Done means

405/400/422 from the loop are near zero over a full cycle, every roster service either succeeds or is removed with a stated reason, Ring Tick is fixed or gone, and `npm test` passes (no `tail` pipe).
~~~~

### `docs/agent-tasks/fix-x402-wallet-health.md` (whole file)

~~~~markdown
# Task: Fix x402 ring wallet health (SOL floors, unconfigured wallets, USDC float)

## UPDATE 2026-07-25 (owner funded the ring, read before acting)

The owner deposited 2 SOL into the sponsor wallet and it has been distributed: payer `X4o2Uu…` now holds ~0.15 SOL + ~$54 USDC (0.6 SOL was swapped to USDC via Jupiter, tx `ReVNCLDvGH9hgCs9rpKkKqMpeC7Zw5xTStaPNN1nByMy5RLyg4TYw5ZqT9y5KgZC1EnztxnPzdn3J3MDkC6sgpm`), sponsor ~0.26 SOL, treasury ~0.30 SOL, and each agent wallet ~0.07 SOL. Daily caps were raised on Cloud Run (autonomous $30→$100/day, ring settle $150→$500/day). Do NOT ask the owner for more funding and do NOT re-run a top-up. Your remaining scope: items 1, 2 and 5 below, plus root-causing why the automated rebalancer swept 0.5 SOL of fresh funding straight back to the owner master wallet (`wwwqvAbN4R…`) within seconds of the deposit; that sweep fights any future funding and its threshold or logic likely needs tuning. An automated rebalancer IS active (it moved funds within seconds on 2026-07-25 13:01 UTC); find it before changing anything.

## Context (verified 2026-07-25)

The x402 ring economy recirculates real USDC between three.ws-controlled Solana wallets, settled by our own facilitator (`docs/x402-ring-economy.md` is required reading; self-pay is the operative default, so each payer wallet pays its own ~5,000 lamport fee and its SOL balance is the hard stop that pauses the loop).

Wallet-side failures in `x402_autonomous_log` (Neon, `DATABASE_URL` in `.env`):

- `sponsor_sol_floor` 4,797 all-time and 2,527 in the last 48h, meaning it is active and getting worse: wallets are at or under their SOL fee floor and settlement is refusing to proceed.
- `insufficient_payer_usdc` 4,143 all-time: some payer wallets have run dry of USDC float while others presumably hold the recirculated balance.
- `wallet_unconfigured` 2,528 all-time, 471 in the last 48h: part of the loop roster points at wallets that do not exist or have no key configured.
- `not_settled` 445 in the last 48h.
- Related caps, working as designed but worth a sanity pass: `cap_would_exceed` 4,017, `ring_daily_cap_reached` 1,377.

## Job

1. Map the ring wallet set: the `x402_ring_wallets` and `x402_ring_ledger` tables, plus wherever keys/addresses are configured (Cloud Run env on `three-ws-api`, Secret Manager). Produce a live balance table: wallet, role, SOL, USDC, floor status.
2. Fix `wallet_unconfigured`: either configure the missing wallets properly or remove the roster entries that reference them. No dead entries left.
3. Rebalance: top up SOL on payer wallets below floor and redistribute USDC float so no payer starves. There is likely an existing rebalance mechanism (`api/_lib/economy-rebalance.js` exists; find how it is triggered and why it is not preventing this). Fix the automation so balances self-heal; a one-time manual top-up that decays back into this state within days is a failed fix.
4. IMPORTANT SPEND GATE: moving SOL or USDC between wallets is an on-chain spend action. Before executing any transfer, print recipient, amount, token, chain and get an explicit yes from the owner in the chat. Design and wire everything first so the approval is one yes away. Automated recirculation inside the already-approved ring settle path does not need per-transaction approval; NEW funding transfers into the ring do.
5. Sanity-check the caps: report current daily cap values and whether they match the ring economy doc's fee-floor strategy (fewer, larger payments preferred over many micro payments).

## Constraints

- OWNER RULE, overrides everything: do not modify anything that is working today. Balance top-ups and removing dead roster entries are in scope; rewriting settle paths, caps logic, or rebalance code that currently functions is not. If the existing rebalance automation is genuinely broken (prove it), fix it minimally or add a new complementary mechanism rather than replacing it.
- Do NOT touch the autonomous trading bots or their wallets (three.ws/blog/autonomous-trading-experiment). Ring wallets only.
- Never print or log private keys. Never move funds without the explicit confirmation described above.
- Config-only `gcloud run services update` changes are pre-approved; use `--update-env-vars` (merges), never `--set-env-vars`.
- CLAUDE.md rules apply, including: never use em-dash or en-dash characters anywhere.

## Done means

Zero `wallet_unconfigured` in a full loop cycle, `sponsor_sol_floor` and `insufficient_payer_usdc` at zero after rebalance, the self-healing mechanism verified live (show the log line or ledger row where it acted), balance table in the report, `npm test` passes (no `tail` pipe).
~~~~

### `docs/agent-tasks/README.md` (whole file)

~~~~markdown
# Agent task prompts

Self-contained task briefs for Claude agents, written to be pasted (or referenced by path) into a fresh chat. Each file carries all context needed to start cold: verified diagnostic data with dates, the job, constraints, and an explicit definition of done. One agent per file; run them in separate chats so each stays focused.

| File | Task | Depends on |
|---|---|---|
| [fix-x402-502-bursts.md](fix-x402-502-bursts.md) | Root-cause the autonomous loop's Cloud Run 502 bursts and the flapping Redis cache | nothing |
| [fix-x402-caller-mismatches.md](fix-x402-caller-mismatches.md) | Fix deterministic 405/400/422/402 loop failures and the zero-value Ring Tick service | nothing |
| [fix-x402-wallet-health.md](fix-x402-wallet-health.md) | Ring wallet SOL floors, unconfigured wallets, USDC float rebalancing | nothing |
| [new-trading-arm-x402-signals.md](new-trading-arm-x402-signals.md) | NEW trading arm driven by paid x402 signals. On HOLD until owner green-light | 502 + caller fixes landed |

Ground rules baked into every brief: existing autonomous trading arms are untouchable, all payments and trades are real, on-chain spend needs an explicit owner yes, and CLAUDE.md applies in full.

When a task completes, delete its file or mark it done here so a later agent does not re-run it.
~~~~

