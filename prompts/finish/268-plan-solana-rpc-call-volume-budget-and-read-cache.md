# Cut Solana RPC call volume with per-route accounting, request coalescing and a short fresh-read cache

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/268-plan-solana-rpc-call-volume-budget-and-read-cache.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 72 of 100 inside the tier). **Area:** solana. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Production Solana reads and every x402 settle share one rotating endpoint chain (`solanaRpcEndpoints()` in `api/_lib/solana/connection.js`). Right now `/api/healthz` reports `rpc_lanes: all 2 paid lanes exhausted; serving from 0 free lanes` and `helius: quota cooldown, on public RPC`. The platform stays up only by hopping across free lanes that each refuse some call shapes, which shows up as intermittent 5xx, slow settles and `broadcast_failed` (20 of the last 4,768 settles) and `blockhash_expired` verifies. GCP credits cannot buy a Solana node (Blockchain Node Engine is Ethereum-only) and buying plan upgrades is the owner's decision, so the fix an engineer can ship now is to make far fewer calls: know who spends the quota, coalesce duplicate in-flight reads and cache hot reads for a few seconds.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `api/_lib/solana/connection.js` (1,790 lines) implements priority and breaker logic, method-capability routing, transport fallback and a LAST-GOOD stale cache (15 minute TTL, written at most once a minute per key, only served when every lane fails). There is no fresh-read cache, no in-flight coalescing across concurrent identical requests, and no per-route or per-caller accounting of calls.
- Tests exist for routing and breakers: `tests/solana-rpc-priority-and-breaker.test.js`, `solana-rpc-rotating-fetch.test.js`, `solana-rpc-method-capability.test.js`, `solana-rpc-transport-fallback.test.js`, `rpc-rate-limit.test.js`, `money-rpc-resilience.test.js`.
- Probe tool: `scripts/probe-rpc-lanes.mjs`. Lane facts and measured matrix are in `docs/ops/solana-rpc-lanes.md`.
- Health: `api/_lib/health-probes.js` and `api/_lib/ops/subsystem-health.js` expose `rpc_lanes` and `helius`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```sh
curl -s https://three.ws/api/healthz | python3 -c "import json,sys;d=json.load(sys.stdin);[print(s['name'],s['status'],s.get('detail')) for s in d['subsystems']['subsystems'] if s['name'] in ('rpc_lanes','helius')];print(d['x402']['self_facilitator'])"
grep -n "coalesc\|inflight\|callAccounting\|byRoute" api/_lib/solana/connection.js | head
node --env-file=.env scripts/probe-rpc-lanes.mjs 2>&1 | tail -25
grep -rn "getTokenAccountsByOwner\|getBalance\|getAccountInfo" api --include=*.js -l | wc -l
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Accounting first: add a lightweight per-call counter in the connection layer keyed by `(route or caller tag, method, lane)` stored in the shared cache in hourly buckets (reuse `cacheSet`/`cacheGet` in `api/_lib/cache.js`; do not add a vendor), with a caller tag taken from an AsyncLocalStorage context set by the API router in `server/index.mjs` (path) and by crons (name). Add a read-only endpoint or `scripts/rpc-spend-report.mjs` that prints the top 20 `(caller, method)` pairs by calls in the last 24 hours.
2. Measure: run the report against production for a real window and write the top offenders into `docs/ops/solana-rpc-lanes.md` with call counts. Do the next tasks in the order the data dictates.
3. In-flight coalescing: identical concurrent read requests (same method and params, commitment included) share one upstream promise. Never coalesce `sendTransaction`, `simulateTransaction` or anything with a signature the caller will act on.
4. Fresh-read cache with explicit TTLs by method: `getLatestBlockhash` 2 s (must stay under the blockhash validity window and never serve a blockhash older than the verify path tolerates), `getBalance`/`getTokenAccountsByOwner`/`getAccountInfo` 3 to 5 s unless the caller passes `{ fresh: true }`, `getSignatureStatuses` never cached for pending signatures, 30 s once finalized. Settle, send and verify paths pass `fresh: true`. Tests first in a new `tests/solana-rpc-read-cache.test.js`: hit, expiry, fresh bypass, error not cached, no coalescing for writes.
5. Cut the top three offenders at the source (batch with `getMultipleAccounts`, raise a poll interval, memoize a holder gate for a minute) and record the before and after call counts.
6. Add a daily budget guard: when a paid lane's call count crosses a configurable fraction of its known quota (`RPC_LANE_BUDGETS` JSON env), demote it for non-money callers first so settles keep the paid lane. Test in `tests/solana-rpc-priority-and-breaker.test.js`.
7. Surface `calls_24h` and the top caller in the `rpc_lanes` health detail so the next quota event tells the on-call who spent it.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npm test -- tests/solana-rpc-read-cache.test.js tests/solana-rpc-priority-and-breaker.test.js tests/money-rpc-resilience.test.js` pass.
- [ ] `node --env-file=.env scripts/rpc-spend-report.mjs` prints a ranked table with non-zero counts after a local run of the API.
- [ ] `docs/ops/solana-rpc-lanes.md` records before and after call counts for the top three offenders, with at least a 40 percent reduction in total calls per 24 hours measured after deploy (state the measured value).
- [ ] x402 self-facilitator `verify` rejection `blockhash_expired` does not increase relative to the pre-change figure in `/api/healthz`.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Paid lanes are over quota so the probe shows little | Run the report from the cache counters, which do not need a healthy lane; the probe script still ranks free lanes by call shape. |
| Wanting to buy a plan or a node | Not the task; reduce volume and document the residual need in the report for the owner. |
| Cannot reproduce production traffic locally | Replay a recorded request mix from the counters in a test harness; do not mock results as if live. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/268-plan-solana-rpc-call-volume-budget-and-read-cache.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `268-plan-solana-rpc-call-volume-budget-and-read-cache.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/ops/ISSUES.md` (whole file)

~~~~markdown
# Production Issues - three.ws

Live tracker for known production issues. When an item is fixed, drop it from
this file rather than leaving it here marked ✅ - this file should only contain
work that is still open.

> The 2026-05 incident batch (20 items, all resolved) and the 2026-06 resolved
> items were archived under `docs/internal/`, which was removed from the repo
> along with the rest of the internal content in commit `b80c1c379`. Both
> archives remain readable in git history:
> `git show b80c1c379^:docs/internal/ISSUES-ARCHIVE-2026-05.md`

---

## Check the deploy gap before debugging anything here

`curl -s https://three.ws/api/version` returns the live commit; compare it to
`main`. Reading the repo tells you what SHOULD be true in production, not what
is: this list has more than once carried confident claims about live mitigations
that had never been deployed.

**Deployed 2026-07-30: production moved `d6a7bf2a4` (2026-07-28) to `bbe5d2403`,
closing a ~70 commit gap.** That alone fixed three items that had been sitting
here as code-complete, each verified live afterwards rather than assumed:
ENS resolution, web search running on scraps, and the stale accuracy number the
`/fact-check` page was publishing. Post-deploy sweep was 465/466 pages
(the one miss was a blog route that landed 6 minutes after the built commit).

Deploys are owner-gated (CLAUDE.md gate 2), so a correct fix can sit unshipped
indefinitely. When an item says "needs deploy", no further engineering is
required. `npm run db:status` reports all migrations already applied.

## Open

Re-verified against the live Cloud Run services on 2026-07-22. The 2026-07-04
log-export batch is now mostly closed: `JWT_SECRET` and `WALLET_ENCRYPTION_KEY`
are set on `three-ws-api` (wallet sign-in and custodial provisioning work),
`ADMIN_CODE` is set on `hyperfy-world` (world.three.ws build rights are gated
again), and the reconstruct lane has a real fallback via
`GCP_RECONSTRUCTION_URL`. What remains requires owner/operator action outside
this repo:

1. **LLM paid backstops are dead** (owner billing decision). `OPENAI_API_KEY`
   is set on the service but the account returns `billing_not_active` 429s, so
   every OpenAI paid backstop is out. The OpenRouter platform key burned its
   credit on paid-model routing (invisible in metering: llm-pricing records
   OpenRouter as $0). Traffic survives on the free lanes (Groq/NIM plus the
   vertex-gemini credits anchor). Action: reactivate OpenAI billing and/or
   fund the OpenRouter key, or accept free-lane-only service.
2. **Every paid Solana RPC lane is over quota at once** (owner action: money).
   Re-probed 2026-07-30 with a metered `getBalance` (never `getHealth`, which is
   unmetered and returns ok on an exhausted endpoint): Helius `-32429 max usage
   reached`, QuickNode `-32003 daily request limit reached`, and BOTH Alchemy
   apps (`ALCHEMY_API_KEY` and the key inside `SOLANA_RPC_FALLBACK_URLS`) return
   `429 Monthly capacity limit exceeded` (they share one account quota, so the
   second is not a spare). The dead Alchemy endpoint was also pinned as
   `SOLANA_RPC_URL`, so every production Solana call began by failing over.
   Mitigated in config on 2026-07-30 (current revision `three-ws-api-00346-x9m`):
   `SOLANA_RPC_URL` points at `https://rpc.magicblock.app/mainnet`, with
   `api.mainnet-beta.solana.com`, PublicNode and Leo RPC as the fallbacks.
   **Pick the primary by call SHAPE, not by a `getBalance` probe.** All the free
   lanes pass `getBalance`, `getLatestBlockhash` and `getSignatureStatuses`
   12/12, which makes them look interchangeable. They are not: on
   `getTokenAccountsByOwner` filtered by `programId`, the call every token and
   USDC balance reader makes constantly, PublicNode returns **HTTP 403
   `blocked parameter: params.1.programId`** and Leo RPC returns `-32603`.
   Only MagicBlock and `mainnet-beta` serve it, which is why they hold the top
   two slots. Promoting PublicNode is actively harmful before commit `61f3ae758`
   ships, because that 403 was sized as an auth failure and parked the whole
   node for 30 minutes on ordinary traffic. The exhausted paid lanes stay in the chain and
   re-enter rotation on their own when quota resets (`QUOTA_COOLDOWN_MS` is 6h).
   The platform is therefore up but throttled, which shows up as intermittent
   5xx and slow settles. Action: top up or upgrade a plan, or cut call volume
   via the ring cadence knobs. Note GCP credits cannot help here: Blockchain
   Node Engine is Ethereum-only, so there is no GCP-hosted Solana RPC.
   **Partly relieved 2026-08-12: a fresh Helius key on a new free-plan account
   is now set as `HELIUS_API_KEY` in the local `.env`.** Probed with metered
   calls only, it serves 6 of the 7 production call shapes at p50 33 ms, the
   fastest lane in the chain, and `solanaRpcEndpoints()` places it first, ahead
   of the keyless free tail (the one miss is `getProgramAccounts`, which every
   other lane also refuses). Its Helius-only surfaces answer too: DAS `getAsset`
   and `getTokenAccounts`, `getPriorityFeeEstimate`, the `/v0` parsed
   transaction history, and the webhooks API. Free plan means the quota is
   modest, so this restores the DAS and holder surfaces rather than replacing a
   paid lane. **Production still runs the exhausted key** until the Cloud Run
   env update lands: `gcloud run services update three-ws-api --region
   us-central1 --project aerial-vehicle-466722-p5 --update-env-vars
   HELIUS_API_KEY=<key>` (single-key merge, never `--set-env-vars`).

Carried forward from the retired `prompts/x402-catalog/` tracker (campaign
closed 2026-07-28; full history in git):

3. **Fact-check benchmark cannot be re-run from this machine** (owner action:
   one credential). The two halves of this item that were about code and about
   the deploy are both closed, verified live on 2026-07-30 after the deploy:
   web search really does lead with Vertex-grounded Google Search now (a live
   call to `POST /api/x402/fact-check` returned `supported` at 0.98 confidence
   with `vertexaisearch.cloud.google.com` grounding sources, not DuckDuckGo
   scraps), and `GET /api/fact-check-benchmark` now returns `ran: false` instead
   of serving the stale 2026-07-08 run, so `/fact-check` renders its honest
   "not yet run" state to visitors rather than a misleading 20%.
   What remains is only the measurement. `scripts/fact-check-benchmark.mjs`
   targets the PAID endpoint `https://three.ws/api/x402/fact-check`, which
   answers a small free allowance and then 402s, so a 40-claim run needs a
   bypass. Neither bypass exists: there is no token with the `x402:bypass`
   OAuth scope, and `INTERNAL_API_KEY` (the `x-api-key` service path in
   `api/_lib/x402/access-control.js`) is unset both locally and on the
   `three-ws-api` Cloud Run service. Action: set `FACT_CHECK_BYPASS_TOKEN`, or
   set `INTERNAL_API_KEY` on the service and pass it as `x-api-key`. Then
   `node scripts/fact-check-benchmark.mjs`. The runner refuses to publish any
   run with >10% errored claims, so a degraded run cannot poison the page.
4. **Replicate is an unfunded optional image lane** (owner action,
   non-blocking). Narrowed on 2026-07-30: two of this item's three original
   claims were stale and are struck. ASR **works**, `NVIDIA_ASR_FUNCTION_ID` is
   set and `GET /api/v1/ai/asr` returns 200 `configured: true`, with a real 16kHz
   WAV round-tripping in 1.5s via `riva-asr`. Redis is **present**, not absent:
   `UPSTASH_REDIS_REST_URL` points at a self-hosted SRH proxy on the VPC, and the
   ASR quota counter decrementing proves the store is live. Only
   `REPLICATE_API_TOKEN` is genuinely absent, and `api/_lib/ai-image-lanes.js`
   treats Replicate as one of three lanes with Vertex serving the traffic, so
   nothing is degraded. Fund it only if a third image lane is wanted.
5. **BSC testnet contracts are code-complete but never publicly deployed**
   (owner action; re-homed here 2026-07-30 when the BNB Chain campaign's work
   orders were retired). Every contract proof in that campaign ran against an
   anvil fork or a local instance because no funded deployer key exists:
   `BNB_TESTNET_DEPLOYER_KEY` is absent from the shell env, the root `.env`, and
   `contracts/.env`, and the public faucet is reCAPTCHA-gated, so the
   `GreenfieldVault` and `WorldMoves` deploys and every real Greenfield write
   never happened. The deploy scripts are dry-run verified and unchanged
   (`forge script script/DeployGreenfieldVault.s.sol` /
   `script/DeployWorldMoves.s.sol --broadcast`, both documented in
   [contracts/DEPLOYMENTS.md](../../contracts/DEPLOYMENTS.md)). Action: fund a
   throwaway EOA at `https://www.bnbchain.org/en/testnet-faucet`, set
   `BNB_TESTNET_DEPLOYER_KEY` (and `GREENFIELD_VAULT_OPERATOR_KEY`, which falls
   back to the same key), re-run the two scripts, then set
   `WORLD_MOVES_ADDRESS_TESTNET`. No code change is needed: the moment the
   address exists, `/api/bnb/world-config` starts returning `deployed:true` for
   real visitors and the sender/reader/ghost paths light up as already proven.
   Full history: `prompts/bnb-chain/PROGRESS.md`.

6. **The x402 sponsor has under a day of runway** (owner action: ~1 SOL).
   Re-measured 2026-07-31: the sponsor
   (`WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW`) holds 0.0318 SOL, barely
   above its 0.03 floor, against a measured burn of 0.060 SOL/day (7 days of
   `fee_lamports` over successful settles): roughly half a day of runway.
   Do not quote a remembered burn rate
   here; the previously circulated "1 to 2 SOL/day" was wrong by roughly 10x.
   ~1 SOL covers about 16 days at the current burn. The number is now live on
   the payment-outcome board: `GET /api/ops/payment-outcomes` shows balance
   vs floor, measured burn, and runway (see `docs/ops/payment-outcomes.md`; ships with the next
   deploy). **Never top up per-agent wallets**, that strands
   SOL and kills the rail. Related but already handled: the earlier
   `fee_wallet_below_floor` outage (18:00 to 02:45) was a symptom of item 2, not
   an independent fault, and cleared with no funding the moment `SOLANA_RPC_URL`
   was repointed. Do not lower `X402_SPONSOR_SOL_FLOOR_LAMPORTS`; the shortfall
   was 0.00018 SOL and the floor was doing its job.

7. **`x402_settle` reports degraded, and what remains is rail faults**
   (closes with item 2). Re-read 2026-07-31 01:10 UTC: the sensor is DOWN at
   30.3% (549/1813 paid attempts, 3h) with the faults dominated by `http_502`
   (1055) and `http_402` (153), so the degradation has deepened since the
   repoint; the free lanes alone are not holding the rate. Earlier readings:
   near 78% on 2026-07-30, 95.2% in the hour right after the RPC repoint. Every current failure is RPC-shaped rather than financial:
   `broadcast_failed` with empty simulation logs, `Blockhash not found`, and
   malformed-response parse errors. The test that settles this is grouping
   failures by payment amount, because they are amount-independent and the
   *smallest* bucket has the worst ratio, which insufficient funds cannot
   produce. Free lanes cap the achievable rate at roughly 82-95%, so restoring
   one paid RPC plan is the fix.

8. **The OKX marketplace chat bot is logged out** (owner action: one login).
    Chat for OKX agent #2632 is delivered by a local `okx-a2a` daemon plus an
    `onchainos` wallet session, both outside this repo. The daemon is staged and
    running with skills linked; only the wallet session is logged out, and
    finishing it needs a human (email OTP as `claude@three.ws`). Run
    `npm run okx:bot` for the current login URL and the follow-up poll command:
    exit 0 means online, exit 2 means staged but logged out. A codespace cannot
    stay up on its own, so an always-on host is the durable fix.

Found by the 2026-07-30 documentation audit, which read the handlers behind
every surface it documented. Only the production-affecting findings are listed
here; the code-quality items from that pass are not production issues.

---

## Recently closed (do not re-open without new evidence)

Kept briefly because each one was previously mis-stated on this list, and the
wrong version is what a future reader would otherwise trust.

- **Live R2 CORS did not match `scripts/set-r2-cors.mjs` (filed 2026-07-30, fixed and closed
  2026-09-10).** The bucket served one legacy allowlist rule for both reads and writes, so a
  foreign origin got the bytes with no `access-control-allow-origin` and its `OPTIONS`
  preflight was a bare `403`. Every prior pass recorded this as blocked on one owner-minted
  credential, on the finding that the only reachable `S3_*` pair was object-scoped and
  `403 AccessDenied` on Get/PutBucketCors. **That finding no longer holds.** The pair resolved
  off the Cloud Run service with
  `node scripts/read-service-env.mjs '^S3_(ACCESS_KEY_ID|SECRET_ACCESS_KEY|BUCKET|ENDPOINT|PUBLIC_DOMAIN)$'`
  (which follows the Secret Manager reference that `describe` shows as `valueFrom`) is
  admin-scoped: `--get` read the live policy and the apply path wrote the new one. No token was
  minted. The canonical policy is live, split as the script always intended into a world-open
  `public-read` rule (GET/HEAD, `*`) and an origin-locked `browser-upload` rule (PUT).
  Verified 2026-09-10 by raw `curl` on a real object and by `node scripts/set-r2-cors.mjs --probe`,
  which now exits 0 with every origin matching expectations: foreign origins read and cannot
  write, and `www.three.ws`, `*.app.github.dev` and `localhost:5173` write again. That last row
  also retires the first-party breakage filed beside this item, where the www host served the
  app but had every GLB blocked by the browser; the `server/index.mjs` www-to-apex redirect
  remains correct and ships independently. The `/cdn/<key>` and `/api/glb` routes stay the right
  advice for callers that cannot set an origin, and were not touched.

- **Object storage rejected our credential (filed and closed 2026-09-09).** For
  part of 2026-09-09 `/api/healthz` reported the `object_storage` subsystem
  `down` with `credentialFault: true` and the bucket's own
  `SignatureDoesNotMatch`: the access key id was accepted, so the secret was
  what was wrong. Uploads answered `503 storage_unavailable`, both library
  manifests answered `{"total":0}`, and forge image generation was 0/30 over six
  hours. `S3_SECRET_ACCESS_KEY` on `three-ws-api` is a Secret Manager reference
  (`secret:s3-secret-access-key:latest`) and rotating it is owner-gated from an
  agent machine, so the item was filed for the owner. Re-measured the same day
  and every symptom is gone: `object_storage` is `ok` (`signed read ok, 216ms`),
  `POST /api/forge-upload` returns `200` with a presigned URL,
  `/api/avatars/library` and `/api/objects/library` return 107 and 511 entries,
  and `forge_generation` is `ok` at 95% (60/63 finished, 6 hours). Nothing in
  this repo changed: on Cloudflare R2 the secret access key is the API token's
  SHA-256 digest, and a wrong or newline-padded value fails exactly this way, so
  if it recurs the fix is that one secret, never the code.

- **`/api/avatar/optimize?draco=1` (closed 2026-08-01).** It returned
  `500 transcode_failed` with `draco.createCompressedPrimitive is not a function`
  because the deployed image had resolved an older `@gltf-transform` than the
  pinned `^4.4.0`. This was always dependency drift in the image, never a code
  bug. The 2026-08-01 rebuild fixed it, verified live against production:
  `curl "https://three.ws/api/avatar/optimize?src=https://three.ws/avatars/cesium-man.glb&draco=1"`
  returns `200` with a 129,972-byte GLB stamped `glTF-Transform v4.4.0`. The two
  sibling defects filed under the same item also shipped: the silent-expression
  report (`x-render-expression` on `/api/avatar/render`, pinned by
  `tests/api/avatar-render-expression-report.test.js`) and the oversized-source
  stall (streaming 50 MB cap returning `413`/`504`, covered by
  `tests/avatar-optimize-source-cap.test.js`).

  A second, unrelated defect on the same endpoint was found once the 500 was
  gone and is **also closed (2026-08-13)**: `?draco=1` returned a file BIGGER
  than its input (default.glb 748,088 to 890,160, +19.0%; michelle.glb 849,756
  to 974,036, +14.6%) and said nothing about it. Cause: stored avatars are
  quantized and meshopt-packed, gltf-transform keeps `EXT_meshopt_compression`
  attached after reading, so Draco was layered beside the meshopt payload and
  re-quantized already-quantized attributes. The pipeline now drops the other
  mesh-compression scheme and dequantizes before encoding, keeps whichever
  encoding is actually smaller, and falls back to the original bytes when
  nothing helped. `x-three-ws-optimize` / `x-three-ws-optimize-refused` report
  which happened. Pinned by `tests/avatar-optimize-never-inflates.test.js`.

- **The autopilot spend default.** `POST /api/agents/:id/autopilot/run` read
  `body?.dry_run === true`, so a bare `POST {}` ran a REAL cycle while the
  sibling runner on the same wallet (`api/agents/wallet-intents.js`) read
  `dry_run !== false` and simulated. Now `body?.dry_run !== false`: silence
  simulates, and spending must ask for itself. The cockpit's Run button relied
  on the unsafe default, so it now sends `dry_run: false` explicitly and asks a
  second time before spending; a Preview cycle button runs the simulation.
  Pinned by `tests/autopilot-run-dry-run-default.test.js` (3 of its 6 cases fail
  against the old expression).
- **The `/pulse` marketplace GMV.** This list said "a confirmed `trial` row with
  a non-zero amount inflates published GMV". **That mechanism never occurred**:
  a trial is written `status='trial', kind='trial'` and only a `'pending'` row
  is ever promoted to `'confirmed'`, so the `status='confirmed'` filter already
  excluded every trial. Live data agrees: all 10,454 `skill_purchases` rows are
  `kind='trial', status='trial'`, and there is not one confirmed purchase yet.
  The defect was real but latent: the money aggregates filtered on status alone
  while the counts filtered on status AND kind, so they rested on an invariant
  nothing enforced, and a trial carries the listing's FULL price in `amount`
  despite nothing being paid. Every aggregate now derives from one shared
  `paidRow` predicate, `series_7d` included. Do not re-file this as an
  observed inflation of a published number; it was never that.
- **Oversized sources on `/api/avatar/optimize`.** See item 9.
- **Neon storage pressure.** `isStoragePressured()` reports `pressured: false` at
  2768MB, and `SHOW neon.max_cluster_size` returns **16TB**, so the 8192MB
  high-water on the service is a deliberate runaway backstop rather than a cap
  being approached. Worth watching only because the branch grew ~230MB in a day.
- **ASR and Redis.** See item 5: both were listed as unconfigured and both work.
- **World blueprint assets.** The `world` subsystem reported "1 blueprint
  asset(s) missing" while all 17 distinct assets served 200 to an independent
  sweep. The sensor swept the blueprint list verbatim (136 entries for 17 files)
  and treated a single transient HEAD timeout as a hard 404, parking a degraded
  verdict for the full cache hour. Now it sweeps distinct assets, retries a
  transient failure once, logs which URL is implicated, and only a 404/410
  counts. `world` reports ok.
- **Three shadowed agent routes.** `GET /api/agents/ens/:name`,
  `GET /api/agents/8004/agent` and `GET /api/agents/8004/search` all answered the
  agent-profile dispatcher's "agent not found": the broad
  `/api/agents/([^/]+)(?:/.*)?` route sat above them and, being pre-filesystem,
  the filesystem phase never saw them either. `api/agents/ens/[name].js` had
  never served a request, and `/demos/erc8004` could neither search the registry
  nor open an agent. Routes added above the catch-all and pinned by
  `tests/vercel-agents-subpath-routes.test.js`. Ships with the next deploy.
- **The seed cron's 409 storm.** Every payment in a batch was built from
  identical inputs with a fixed priority fee, so all N serialized to the same
  bytes, collided on one hashed payment id, and 409'd on all but one (about 40 of
  41 lost per tick, the largest single source of 4xx on the fleet). The compute
  unit price now varies by index. Cover:
  `tests/x402-seed-tx-uniqueness.test.js`.
- **Redis proxy SIGBUS.** `three-ws-redis-proxy` was crashing on signal 10 at
  512Mi, which surfaced as cache SET timeouts and rate-limiter degradation while
  healthz still read `cache: ok` because the memory fallback masked it. Raised to
  1Gi.
- **The bridge-down alert carried no information.** Its message escaped its own
  template interpolations, so it logged the literal source text instead of the
  count and the bridge names.
~~~~

### `docs/ops/solana-rpc-lanes.md` (whole file)

~~~~markdown
# Solana RPC lanes: diagnosis, capability, and failover

Every Solana read and every x402 settle in production goes through one rotating
endpoint chain built by `solanaRpcEndpoints()` in
[api/\_lib/solana/connection.js](../../api/_lib/solana/connection.js). When that chain
misbehaves the symptoms are never a clean outage: intermittent 502/503/504 on on-chain
routes, `broadcast_failed` settles, holder gates that refuse a real holder, and a settle
rate that sags without any wallet actually being empty.

This runbook is the whole-tier view. For the single log signature see the `rpc_lanes`
section of [production-log-triage.md](production-log-triage.md); for the money side see
the settle-floor and dispersion notes in the same file.

## Diagnose the whole tier in one sweep

```sh
node --env-file=.env scripts/probe-rpc-lanes.mjs          # lane x method matrix
node --env-file=.env scripts/probe-rpc-lanes.mjs --ws      # also probe logsSubscribe
node --env-file=.env scripts/probe-rpc-lanes.mjs --json    # machine-readable
```

[scripts/probe-rpc-lanes.mjs](../../scripts/probe-rpc-lanes.mjs) resolves every lane in
the exact order `solanaRpcEndpoints()` does, then probes each one against the call
shapes production actually makes: `getLatestBlockhash`, `getBalance`,
`getSignatureStatuses`, `getTokenAccountsByOwner` (programId filter),
`getProgramAccounts`, `getAccountInfo`, and `simulateTransaction` as a read-only
stand-in for `sendTransaction`. It prints the matrix, then every refusal verbatim with
its JSON-RPC code, then a per-lane verdict: `safe as primary`, `usable, NOT safe as
primary - missing <methods>`, `quota spent`, `key rejected`, or `DEAD`. It exits 1 only
on `DEAD` (serves nothing and gives no reason), so a routine daily cap does not cry
wolf. It classifies refusals by importing `isMethodRefusal` from the router itself, so
the matrix and the breaker cannot drift apart.

Measured 2026-08-01 (10 lanes, 8 shapes with `--ws`):

| Lane | shapes served | verdict |
|---|---|---|
| MagicBlock | 7/8 | safe as primary (refuses `getProgramAccounts`) |
| `api.mainnet-beta.solana.com` | 7/8 | safe as primary (refuses `getProgramAccounts`) |
| Alchemy (both apps) | 6/8 | safe as primary; `getProgramAccounts` over CU/s cap |
| PublicNode | 5/8 | not a primary: refuses `getTokenAccountsByOwner` |
| Tatum (both hosts) | 2/8 | free tier gates balance + token + program reads |
| Leo RPC | 2/8 | thin, high latency |
| QuickNode | 0/8 | quota spent (`-32003` daily cap) |
| Helius | 0/8 | quota spent (bare HTTP 429) |

Only MagicBlock and `api.mainnet-beta.solana.com` served `logsSubscribe`.

To probe by hand instead, use a **metered** method on every configured lane:

```sh
gcloud run services describe three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 --format=json \
| jq -r '.spec.template.spec.containers[0].env[]
         | select(.name|test("SOLANA_RPC_URL|SOLANA_RPC_FALLBACK|SOLANA_RPC_FALLBACKS|SOLANA_RPC_LAST_RESORT"))
         | .value' \
| tr ',' '\n' | sed '/^$/d' | while read -r url; do
    printf '%s  ' "$(printf '%s' "$url" | sed -E 's#(api[-_]key=|/v2/)[A-Za-z0-9_-]+#\1***#g')"
    curl -s --max-time 10 "$url" -X POST -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW"]}' \
    | head -c 160; echo
  done
```

**Never probe with `getHealth`.** It is unmetered and returns `ok` on an endpoint whose
plan is hard-exhausted, which is exactly how a dead tier reads as healthy.

Exhaustion is worded differently by every provider, and the wording is what the breaker
classifies on:

| Provider | Signature | Window |
|---|---|---|
| Helius | `{"code":-32429,"message":"max usage reached"}` | plan, until topped up |
| QuickNode | HTTP 429 + `{"code":-32003,"daily request limit reached"}` | daily, resets |
| Alchemy | HTTP 429 + `{"code":429,"Monthly capacity limit exceeded"}` | monthly, until the billing month rolls |

## The lanes are not interchangeable

A lane answering `getBalance` does **not** qualify it as a primary. Each free lane
refuses a different subset of methods, and which ones changes without notice.
Re-measured 2026-08-07 (3 samples per cell, p50 of the three):

| Lane | `getBalance` | `getTokenAccountsByOwner` | `getProgramAccounts` | p50 |
|---|---|---|---|---|
| `api.mainnet-beta.solana.com` | 3/3 | 3/3 | 403 IP block | 94ms |
| PublicNode `solana-rpc.publicnode.com` | 3/3 | **20s timeout** | -32010 not indexed | 137ms |
| Leo RPC `?api_key=FREE` | 3/3 | 2/3 (`-32603`) | 429 | 254ms |
| Tatum `api.tatum.io/v3/...` | **-16401 paid only** | **-16401 paid only** | 429 | 58ms |
| Tatum `solana-mainnet.gateway.tatum.io` | **-16401 paid only** | **-16401 paid only** | 429 | 70ms |
| MagicBlock `rpc.magicblock.app/mainnet` | **403 IP block** | **403 IP block** | **403 IP block** | 159ms |

**`api.mainnet-beta.solana.com` is now the best free primary**, and it is the only
keyless lane serving both `getBalance` and `getTokenAccountsByOwner`.

Three lanes that a naive latency ranking would promote are traps:

- **MagicBlock was the recommended primary until 2026-08-07**, when it began answering
  every method with HTTP 403 "Your IP or provider is blocked from this endpoint". It is
  pruned from `FREE_KEYLESS_MAINNET` entirely: a hard egress block never recovers on a
  cooldown, so re-probing it only burns a real request to relearn the block.
- **Both Tatum hosts** are the fastest numbers in the table and the least useful: they
  gate `getBalance` and `getTokenAccountsByOwner` behind a paid plan (`-16401`) and cap
  the keyless tier at 5 requests/minute. They now rank last, behind mainnet-beta.
- **PublicNode** serves `getBalance` perfectly while refusing precisely the calls behind
  $THREE holder gating and token balances
  ([api/\_lib/balances.js](../../api/_lib/balances.js),
  [api/\_lib/coin/holders.js](../../api/_lib/coin/holders.js),
  [api/\_lib/embed-gate.js](../../api/_lib/embed-gate.js),
  [api/scene/gate-check.js](../../api/scene/gate-check.js)), and it does so by *hanging*
  rather than erroring, so each first call costs the full attempt timeout before the
  method demotion parks it. Putting it in front of those readers takes the feature down
  while every dashboard still reads green.

### `getTokenLargestAccounts`: the shape with no free primary (measured 2026-08-12)

Holder distribution reads that shape and nothing else can substitute for it:
[api/\_lib/crypto-token-holders.js](../../api/_lib/crypto-token-holders.js) behind
`/api/crypto/holders`, and the concentration half of `/api/crypto/security`. With
Helius at `max usage reached` and Alchemy at `Monthly capacity limit exceeded` on
the same day, the keyless tail had to carry it, and every lane in front failed in a
different way:

| Lane | `getTokenLargestAccounts` |
|---|---|
| PublicNode | hangs forever (no answer at 35s) |
| `api.mainnet-beta.solana.com` | HTTP 429 |
| Leo RPC | `-32603 Internal JSON-RPC error.` on every call |
| Solana Vibe Station `public.rpc.solanavibestation.com` | serves it; throttles to a few requests, then `-32005` |
| Tatum (both hosts) | serves it, at 5 requests/minute |

Three fixes landed together, and the endpoint went from roughly one success in three
to 8/8 on a warmed instance:

- **`-32603` is now a failover signal** ([classifyRpcBody](../../api/_lib/solana/connection.js)).
  It is the JSON-RPC spec's "internal error", the node's own fault rather than a
  deterministic verdict, so unlike `-32601`/`-32602` the next lane may well serve it.
  Unclassified, Leo's envelope was handed back as though it were the chain's answer
  and the lanes that do serve the shape were never tried.
- **A hang past the attempt bound demotes the (lane, method) pair**, not the lane
  (`throwDisposition`). Charging PublicNode's silent refusal to the whole lane benched
  the free chain's primary for every other method. This is the behaviour this runbook
  already described; before 2026-08-12 the code cooled the lane instead.
- **Solana Vibe Station joined `FREE_KEYLESS_MAINNET`**, behind Leo and ahead of the
  Tatum pair. Verified real mainnet (genesis `5eykt4Us...`, slot within 1 of
  mainnet-beta). Its throttle answers `-32005`, which the capacity classifier already
  parks correctly, so it is depth rather than a primary.

**`-32020` (2026-10-09) is a free failover too.** PublicNode and Solana Vibe Station
keep a short ledger, so a `getSignaturesForAddress` whose `until` or `before` cursor is
older than their history answers `-32020 Transaction <sig> not found` while
mainnet-beta answers the same call normally. Handed back as the chain's verdict, it left
both leak scanners unable to read any controlled wallet for six days once their cursors
aged past PublicNode's window. `classifyRpcBody` now rotates on it with `noPenalty`:
nothing is cooled or demoted, because the same lane serves the method for every cursor
it does hold.

The standing cost is unchanged and is a billing decision, not a code one: while both
metered lanes sit at their monthly ceiling, this shape is served only by throttled
free nodes, so it stays the first read to degrade.

A balance read that cannot reach a lane must never be recorded as a balance of zero.
[scripts/audit-service-wallets.mjs](../../scripts/audit-service-wallets.mjs) reports an
unreadable wallet as `‼ unreadable`, and
[scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs) classifies that as `investigate`,
never as the `owner` "fund this wallet" finding. On 2026-08-07 the older behaviour turned
one throttled lane into four fake below-floor money emergencies.

[scripts/audit-wallet-flows.mjs](../../scripts/audit-wallet-flows.mjs) follows the same
rule as of 2026-08-11. It used to coerce every wallet in a chunk whose lane threw to
`0`, so a single failed chunk silently shrank the fleet total by whatever those wallets
held and still exited clean. It now leaves them unread, excludes them from every total,
lists them under `UNVERIFIED`, and exits `2`. A `null` account inside a *successful*
`getMultipleAccounts` response is still a real zero: that account does not exist on
chain. Only a call that threw is an unread.

Both audits prune hosts with a hard egress block from their own lane chains rather than
trusting `SOLANA_RPC_URL` blindly, because that var still points at MagicBlock in `.env`
and on the Cloud Run service. Pointing an audit at a 403 lane is how it came to read
every wallet as empty in the first place.

## Why a refusal must rotate, and when it must not

The breaker splits JSON-RPC errors into two classes:

- **Provider-specific** (capacity, quota, auth, tier gate, policy block). The next lane
  serves the same call, so rotate.
- **Deterministic** (invalid request, method not found, genuinely invalid params, tx
  simulation failed). Every lane fails it identically, so rotating just burns the chain.

Three real phrasings sat on the wrong side of that split until 2026-07-30, each fixed in
`connection.js` and locked down in
[tests/solana-rpc-priority-and-breaker.test.js](../../tests/solana-rpc-priority-and-breaker.test.js):

1. **Alchemy's monthly cap matched no quota phrase.** It took the 10 minute transient
   cooldown instead of the 6 hour quota one, so a lane that could not answer until the
   billing month rolled over re-entered rotation every ten minutes. It was also
   `SOLANA_RPC_URL`, so nearly every Solana call in production began by failing over
   (236 lane failures in 6h).
2. **PublicNode `getProgramAccounts` answers HTTP 200** with
   `{"code":-32010,"… excluded from account secondary indexes; this RPC method
   unavailable for key"}`. A 200 fires no status-driven rotation and `-32010` was not a
   capacity code, so the error surfaced to the caller instead of failing over.
3. **PublicNode `getTokenAccountsByOwner` answers `-32602`** with `"Request blocked.
   Details: blocked parameter: params.1.programId"`. That is a `-32602` which is *not*
   invalid params. Only the wording separates it from a genuine client error, which is
   why the matcher keys on text and a real invalid-params error still refuses to rotate.

Cooldown windows are asymmetric and worth knowing: quota 6h, rate limit 10m, auth 30m,
5xx 2m. One quota trip removes a premium lane for six hours. Verdicts are published to
the shared cache (`rpccool:v1`) so a cold Cloud Run instance inherits them instead of
re-burning a request against a provider already over its cap.

## A refusal demotes the METHOD, not the lane

Benching a lane because it refused one call shape is the wrong disposition, and it was
the live behaviour until 2026-08-01. Two defects compounded: the rotating fetch read the
response body only on a 429, so on PublicNode's `403 blocked parameter` the classifier
saw an empty string and fell through to the **auth** branch, parking a healthy free
primary for 30 minutes on traffic the balance readers generate constantly. The rotation
then cascaded onto the exhausted paid lanes the free chain exists to protect.

The router now tracks capability per `(lane, method)`:

- A refusal demotes that pair for **15 minutes**. The lane keeps serving every other
  shape and never enters cooldown. It is never an auth fault.
- Endpoint selection runs three passes: skip cooling + skip demoted, then forgive
  cooling, then forgive both. The widest pass exists so stale bookkeeping can never
  strand a request that every lane has refused at some point.
- A JSON-RPC batch is skipped on a lane demoted for **any** method it carries: one
  refused member breaks the whole reply.
- Demotions are process-local by design. Re-discovering one on a cold instance costs one
  request that transparently fails over; re-discovering a quota block costs a request
  against a plan already over its cap, which is what keeps a daily cap pinned. That
  asymmetry is why the quota verdict is fleet-shared and this one is not.

**Breadth is what separates a policy block from a ban.** `Your IP or provider is blocked
from this endpoint` is emitted per-method by MagicBlock and `api.mainnet-beta.solana.com`
(for `getProgramAccounts` alone, while serving six other shapes) **and** caller-wide by a
node that has genuinely banned our egress. The wording is identical, so the text cannot
decide it. A lane that accumulates **4 or more** distinct demotions is refusing the
caller, not the call, and takes the full auth-window lane bench, published fleet-wide.
Four is the threshold because the widest legitimate refusal set we run is three (Tatum's
free tier gates three shapes while still serving `getLatestBlockhash` and
`getSignatureStatuses`, which are worth keeping).

## Reading the cooldown state instead of re-diagnosing it

`rpc_lanes` reports which lanes are parked and when each returns, on `/api/healthz` and
on the public [/status](https://three.ws/status) page:

```sh
curl -s https://three.ws/api/healthz | jq '.subsystems.subsystems[] | select(.name=="rpc_lanes")'
```

The `detail` line carries a census (`1/3 paid lanes serving; mainnet.helius-rpc.com back
in 4h12m, …`) and the `lanes` array carries `recoversAt` (absolute, so a cron-parked
snapshot stays true), `recoversIn`, `paid`, and `blockedMethods` per lane. URLs are
masked to scheme + host, so no API key leaves the process. A quota cooldown clears
itself: read these before concluding the tier is dead.

## Config traps

- **A reserve named anywhere else is not a reserve.** `solanaRpcEndpoints()` dedupes to
  the FIRST occurrence, so a URL in both `SOLANA_RPC_URL` and
  `SOLANA_RPC_LAST_RESORT_URLS` is the primary and absorbs 100% of traffic until its cap
  blows. A reserve must appear in `SOLANA_RPC_LAST_RESORT_URLS` and nowhere else.
- **`ALCHEMY_API_KEY` is not the Solana Alchemy lane.** The Solana URL lives inside
  `SOLANA_RPC_FALLBACK_URLS`; `ALCHEMY_API_KEY` stays load-bearing for EVM and NFT paths
  even when Solana capacity is spent, so do not remove it to "clean up". Since 2026-09-09
  the EVM balance read in [api/\_lib/balances.js](../../api/_lib/balances.js) has a keyless
  rung behind it (public EVM RPC for native value, Blockscout for token discovery), so a
  spent Alchemy quota degrades a portfolio instead of answering 503, but the key is still
  the fast path and the only one that covers every chain.
- **Update single keys with `--update-env-vars`.** `--set-env-vars` replaces the entire
  env set on the service.

## Recovery

```sh
# Repoint the primary at a healthy lane (config only, takes effect on the new revision).
# Re-probe with the capability table above before picking one: the right answer
# changes as free providers gate methods. As of 2026-08-07 mainnet-beta is the only
# keyless lane serving getBalance AND getTokenAccountsByOwner.
gcloud run services update three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 \
  --update-env-vars SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

Then confirm the tier view recovered:

```sh
curl -s https://three.ws/api/healthz | jq '.subsystems.subsystems[] | select(.name=="rpc_lanes")'
```

Beyond that, only two things actually clear a quota: **money** (top up or upgrade the
plan) or **less volume** (`X402_RING_TICK_CONCURRENCY` and the ring cadence knobs, which
are config-only and free). Everything else just moves which free node absorbs the
throttling.

### Confirmation poll cadence (the hottest RPC consumer we control)

Every server-signed send, x402 settle, and launch confirms through
`pollConfirmation()` in [api/\_lib/solana/confirm.js](../../api/_lib/solana/confirm.js).
At a flat cadence over the 90s ceiling, one transaction that never lands costs ~75
`getSignatureStatuses` calls plus ~25 `getBlockHeight` calls, and a transaction that
never lands is exactly what happens when the tier is throttled, so the flat cadence spent
the most requests precisely when requests were scarcest.

It now serves the opening polls at the base cadence (where nearly every healthy confirm
lands, so the common path is unchanged) and backs off geometrically after that. Same 90s
ceiling, roughly a third of the requests. All four knobs are read per call, so retuning
is a config-only `--update-env-vars` with no rebuild:

| Var | Default | Meaning |
|---|---|---|
| `SOLANA_CONFIRM_POLL_INTERVAL_MS` | `1200` | opening cadence |
| `SOLANA_CONFIRM_FAST_POLLS` | `3` | polls at that cadence before backing off |
| `SOLANA_CONFIRM_POLL_BACKOFF` | `1.5` | multiplier per poll after that (clamped to >= 1) |
| `SOLANA_CONFIRM_POLL_MAX_INTERVAL_MS` | `6000` | ceiling (clamped to >= the base) |

**GCP credits cannot help here.** Blockchain Node Engine is Ethereum-only and the
BigQuery `blockchain-analytics-*` datasets are EVM chains plus analytics, so the standing
"prefer GCP, credits are pre-approved" rule has nothing to offer this lane. Do not spend
time re-checking it.

## When every lane fails at the wire

Ten unrelated hosts do not die in the same millisecond. On 2026-08-27 the fleet
logged `all 10 endpoints failed this request, fetch failed` about 2,000 times an
hour while a direct probe of the same lanes from the same region answered fine:
when every lane fails with a transport error (DNS, refused socket, reset) inside
one request, the weather is on our side of the wire (instance egress, resolver,
socket pool) and it clears in well under a second. `connection.js` stacks three
answers, cheapest first:

- **The error names the errno.** A thrown fetch carries the undici cause code
  (`ECONNRESET`, `EAI_AGAIN`, `ENOTFOUND`, ...) and the lane it died on, so
  `fetch failed` alone no longer sends a reader hunting for a week. `EAI_AGAIN` is
  a resolver problem, `ECONNRESET` a socket one.
- **One jittered re-sweep.** When the first sweep was transport-only, every lane
  is tried once more after a 250-700 ms pause. An HTTP 429 or a quota body is a
  verdict about the lane, not the wire, and never triggers it.
- **A TLS refusal is a lane verdict too.** A handshake alert or an untrusted
  certificate (`ERR_SSL_*`, `ERR_TLS_*`, `CERT_*`, see `isTlsLaneFault`) means the
  connection reached the provider and the provider's own TLS terminator said no;
  every retry gets the same answer. Those lanes cool for 30 minutes (published to
  the fleet) and never arm the re-sweep. On 2026-10-08 a disabled QuickNode
  endpoint in `SOLANA_RPC_LAST_RESORT_URLS` answered every handshake with
  `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`; read as a 30-second blip it re-qualified
  twice a minute, was the last lane standing whenever the rest were cooling, and
  re-hammered the 429-cooling free lanes on every request through the re-sweep.
  If `curl -v` against a lane ends in `TLS alert, internal error`, the endpoint is
  dead: remove or replace it in the service env.
- **Last-good reads instead of a 502.** Idempotent read methods (`getBalance`,
  `getAccountInfo`, `getMultipleAccounts`, `getTokenAccountsByOwner`,
  `getTokenLargestAccounts`, `getProgramAccounts`, `getSignaturesForAddress`,
  `getTransaction`, the DAS `getAsset*` family, and a few more) answer from the
  last body a lane returned for the identical call, kept in the shared cache for
  15 minutes and marked with an `x-solana-rpc-stale` header carrying its age in
  ms. Blockhash and slot reads are excluded on purpose: a stale blockhash
  produces a transaction that fails later and worse. A success republishes its
  body at most once a minute per call shape, so the steady state costs one cache
  write a minute per distinct read, not one per RPC call.

A batch that a lane refuses for its own per-batch cap (`maximum number of calls
in a batch`, `batch too large`) is split into at most 64 single requests, four at
a time, instead of failing the whole call; the cap is remembered per (lane,
method) for 30 minutes so the next batch goes straight to the split, and a batch
too wide to split rotates to a lane that takes it whole.
[tests/solana-rpc-transport-fallback.test.js](../../tests/solana-rpc-transport-fallback.test.js)
and [tests/solana-rpc-rotating-fetch.test.js](../../tests/solana-rpc-rotating-fetch.test.js)
pin this behaviour.

## Knock-on effects to expect

RPC starvation does not stay in the RPC layer:

- **x402 settles fail as `broadcast_failed`.** The payer signs against their own RPC, so
  a lagging node of ours has never seen that blockhash and preflight falsely rejects a
  valid payment, after the paid handler already ran. `settleRingPayment()` now resends
  with `skipPreflight: true` for that one error class and lets the validator decide.
- **The treasury self-heal stalls**, which strands the x402 sponsor under its SOL floor,
  which withdraws the Solana accept from every 402 challenge and stops the ring.
~~~~

### `docs/ops/production-log-triage.md` (whole file)

~~~~markdown
# Production log triage

Every recurring `error`/`warning` signature that shows up in a production log
export, mapped to its **root cause**, the **exact resolution**, and **who** can
apply it. Built from the `three-ws-character-studio` export on 2026-07-03 and
re-confirmed against the `three.ws` export on 2026-07-05 (same population plus the
two storage-pressure signatures added below - still no code defects). The
signatures are unchanged after the 2026-07-07 move to Google Cloud Run; only the
places you read logs and set env vars changed (Cloud Run + Cloud Scheduler now,
per [docs/ops/gcp-production.md](gcp-production.md)).

The headline finding, so nobody re-derives it: **none of these are code
defects.** Each line is the platform's own graceful-degradation or fail-closed
machinery working correctly - a fallback firing, a circuit breaker holding, a
guard refusing to spend. They are all resolved by an **environment / billing /
activation** action on the Cloud Run service env or in an upstream dashboard, not
by a code change.
Silencing any of them in code would hide a real production signal, so don't.

Severity legend: 🔴 owner decision (money / security / billing) · 🟡 set an env
var or add quota · 🟢 self-healing, no action needed.

> **This table is now machine-checked.** `npm run triage:gcp`
> ([gcp-logs.md](gcp-logs.md)) sweeps WARNING+ logs across the whole Cloud Run
> fleet, matches them against these signatures, and emits a classified action
> plan; agents run the loop via the `/gcp-triage` skill. When you document a
> new signature here, also add it to `KNOWN_SIGNATURES` in
> [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs).
> For the whole-surface answer to "what's wrong with three.ws?", run
> `npm run triage:gcp:deep`: on top of the log sweep it probes the deployed
> version, TLS expiry, fleet revision readiness, every advertised page on the
> live site, cron drift and liveness, pending DB migrations, service-wallet
> floors, and custodial-key health, all read-only and concurrent.

> **You no longer need a log export to see most of this.** The platform now
> self-reports internal-dependency health: **[/status](https://three.ws/status)**
> renders it with a plain-language fix for each degradation, and
> **`/api/healthz`** carries a machine-readable `subsystems` block (database, cache,
> rate limiter, Helius RPC, the whole Solana RPC lane tier (`rpc_lanes`), x402 ring,
> **x402 settlement success**, **Forge 3D generation**, **object storage**, world,
> sniper, the OKX chat bot, x402 config). The uptime cron
> ([api/cron/uptime-check.js](../../api/cron/uptime-check.js)) parks a snapshot
> each tick and re-pages a degradation that persists. Source of the roll-up:
> [api/_lib/ops/subsystem-health.js](../../api/_lib/ops/subsystem-health.js). This
> table remains the deep reference for what each state means and how to clear it.

---

## 🔴 `[ring-invariants] SPEND PATH DISABLED in x402-autonomous-loop`

```
guard env violated:
• X402_CHARITY_AUDIT_BPS = <unset> (expected 0)
• X402_FACILITATOR_URL_SOLANA / X402_SELF_FACILITATOR_ENABLED = enabled=false url=…payai… (expected self)
```

- **Source:** [api/_lib/x402/ring-allowlist.js](../../api/_lib/x402/ring-allowlist.js) `assertRingSpendInvariants`, called each tick by [api/cron/x402-autonomous-loop.js](../../api/cron/x402-autonomous-loop.js).
- **What it means:** the autonomous spend loop is *enabled* but the closed-loop
  guard env is only **half-configured** - `X402_EXTERNAL_ENABLED=false` is set
  (good), but `X402_CHARITY_AUDIT_BPS` is unset and the Solana facilitator still
  points at an external host. The loop **fails CLOSED**: no money moves. It logs
  `error` and fires one throttled critical alert per hour because a partially-off
  guard on a money path is exactly what you want screamed at you.
- **This is not a false alarm** - it accurately reports an unfinished ring
  activation. Resolve it by finishing **or** pausing, not by muting.

**Resolve - pick one (owner):**

1. **Pause cleanly until you're ready to arm the ring** (recommended if you are
   not actively activating): set `X402_AUTONOMOUS_ENABLED=false`. The loop then
   returns `skipped` with **no error and no alert** (guard check never runs).
2. **Finish arming the ring** (moves real USDC - deliberate go-live): set the
   documented safe values from [.env.example](../../.env.example) §x402-ring -    `X402_CHARITY_AUDIT_BPS=0`, `X402_SELF_FACILITATOR_ENABLED=true`, and either
   unset `X402_FACILITATOR_URL_SOLANA` or point it at
   `https://three.ws/api/x402-facilitator`. Acceptance criteria: the guard env
   set is complete and the coverage sweep settles every catalog entry.

---

## 🔴 `[world-health] world is UNPROTECTED - ADMIN_CODE is not set`

- **Source:** [api/cron/world-health.js](../../api/cron/world-health.js).
- **What it means:** the `world.three.ws` Cloud Run service is serving without
  `ADMIN_CODE`, so every visitor has build rights. Logged as `warning`.
- **Resolve (owner):** set `ADMIN_CODE` on the world service and re-run
  `deploy/world/apply-hardening.sh`. It's a security credential the owner must
  choose and store - not something to auto-generate here.

---

## 🔴 `The request signature we calculated does not match the signature you provided` (r2-credential)

**Signature.** Any of: a 502 from `POST /api/forge` or `/api/gpt-forge` carrying that
sentence, `[cdn-object] signed read failed, serving public bucket domain`,
`[avatars/glb] signed read failed, streaming public bucket domain`, `[forge] object
storage rejected the generation`, `[register/prep] object storage rejected the
manifest`, or `object_storage: down` in `/api/healthz`.

The request-log-only form is `HTTP 503 POST /api/forge-upload`. The monitor
classifies that as `r2-upload-unavailable` (owner) because the route has only
two 503 outcomes: storage is absent, or its signing credential is rejected.
Confirm which one from `healthz.object_storage`; do not spend a code-debugging
cycle on a deliberately honest storage preflight response.

The deep monitor runs its log, HTTP/TLS, fleet, page, cron, database and wallet
probes concurrently. Keep child processes asynchronous: a synchronous Cloud
SDK read blocks the Node event loop and turns healthy network probes into a
cluster of false timeouts. Cloud SDK inventory calls also get a three-minute
ceiling because concurrent credential/config reads may serialize.

**What it is.** Cloudflare R2 is refusing our signed requests, and the SECRET is
wrong. Every signed operation fails at once, read and write.

A REVOKED or deleted access key id is a different fault with the same blast radius,
and it does not say `InvalidAccessKeyId`: R2 answers a bare `Unauthorized` (measured
2026-09-08 against an unknown key id). Read the code off the error, not the sentence.
`isStorageInfrastructureError` matches both shapes, so the failovers below fire either
way; before 2026-09-08 it matched only the rotated-secret shape and a revoked key
reached every caller as `502 upstream_error` instead.

**Blast radius.** Re-probed live on 2026-09-07 15:44-16:05 UTC, because the lanes do
NOT all fail the same way and treating them as one outage sends you after the wrong
thing:

- **text→3D is dead.** `POST /api/forge {"prompt":...}` answers `502
  generation_failed` and surfaces R2's `SignatureDoesNotMatch` sentence verbatim to
  the caller. The reference image cannot be parked, so the run dies before it starts.
  Same on the ChatGPT surfaces (they share the bucket, not the endpoint).
- **image→3D from a pasted URL still works, non-durably.** It reaches `status:"done"`
  with a real GLB on the GCS raw-mesh bucket (`storage.googleapis.com/
  three-ws-avatar-reconstructions/`, verified 200 `model/gltf-binary`), because that
  hop never touches R2. But `materializeCreation` cannot copy it, so the reply carries
  `durable:false`: no R2 copy, no DB creation row, no gallery entry, and the mesh is
  only as long-lived as the raw bucket. This is the workaround to give users.
- **Uploads cannot land**, which is what users actually report. The R2 CORS preflight
  passes, then the browser's `PUT` answers `403 SignatureDoesNotMatch` with NO
  `Access-Control-Allow-Origin` on the 403 itself, so the browser hides the status and
  `fetch` throws with nothing to read. Until 2026-09-08 `POST /api/forge-upload`
  presigned fine (200) regardless, so `/forge` could only say **"Network error during
  upload"** and a user had no way to tell our outage from their own signal. The route
  now asks `objectStorageUsable()` (`api/_lib/r2.js`) whether the bucket will accept an
  upload before it mints a URL, and answers `503 storage_unavailable` when it will not,
  which the page renders as "Uploads are down right now. Try again shortly."
  `api/print/upload.js` does the same. Treat **either** phrase in a user report as this
  outage until proven otherwise: the old one means the fix is not deployed yet.
- **Every avatar on the site disappears for signed-in users**, which is the widest
  symptom and the one an anonymous check cannot see. `GET /api/avatars/:id/glb` 502s,
  so the avatar widget that rides along on nearly every page swaps the user's model for
  the `robot` placeholder and logs `[walk] avatar "<id>" failed to load`. The
  authenticated page sweep (`npm run audit:web:login`, then `npm run audit:web`) found
  this on 2026-09-08 as a confirmed error on page after page; it was the only real
  error class in that sweep. That route now streams the public bucket domain through
  itself rather than redirecting, because it exists precisely to add the wildcard CORS
  header that the public r2.dev domain does not send, so a 302 there would turn the 502
  into a CORS failure for the embed SDK and every cross-origin `GLTFLoader`.
- **Agent registration** cannot store its manifest. **`/cdn/*`** cannot read an object
  and answers `502 upstream_error` until the public-bucket fallback (`36b67b8a8`,
  `99c521446`, `2ab1cb56a`) is actually deployed; those commits sat on `main` unshipped
  while production ran `8770c06c2`.

**First seen 2026-09-07**, ~00:19 UTC: generation stopped dead for nearly five hours
and was reported by users in Telegram, not by us, because nothing here had a signal
for it. Two gaps were closed in the same change and both are worth knowing about:
`forge_generation` read `ok, 89% success` throughout (its ledger only contains
generations that got far enough to write a row, so a total stop looked like a quiet
hour), and `isStorageInfrastructureError` matched only the compact
`SignatureDoesNotMatch` code, which appears in `err.name` and never in the sentence
above. `object_storage` now probes the credential directly and the forge sensor now
reports a stall.

**Resolution (owner).** Re-set the secret on the Cloud Run service:

```bash
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars S3_SECRET_ACCESS_KEY=<secret>   # or --update-secrets for a Secret Manager ref
```

Two traps that produce this exact error and look like a correct value:
- On R2 the **Secret Access Key is the SHA-256 digest of the API token**, not the
  token value. Pasting the token itself signs into `SignatureDoesNotMatch`.
- A **trailing newline** in the stored secret fails identically. `env.js` trims
  credential-class values now, so a padded value can only bite a consumer that
  reads `process.env` directly.

Verify with `curl -s https://three.ws/api/healthz | jq '.subsystems.subsystems[]
| select(.name=="object_storage")'`, then one `POST /api/forge {"prompt":"cube"}`.

**No code change routes around it.** The read paths fail over to the public bucket
domain (`/cdn/*` by redirect, `/api/avatars/:id/glb` by streaming it through), which
is rate-limited and uncached, so it is a degradation and not a fix. Writes cannot fail
over at all.

---

## 🔴 `[text-to-image] replicate billing/credit failure: insufficient credit`

- **Source:** the forge text→image lane.
- **What it means:** the Replicate account is out of credit. The forge already
  **degrades to the free NVIDIA NIM lane** (see the `[forge] paid … lane
  unavailable; degrading to free NVIDIA NIM` line), so image generation keeps
  working at lower fidelity.
- **Resolve (owner):** add credit at `replicate.com/account/billing`. No code
  change - the fallback is already correct.

---

## 🔴 502 wave on `/api/x402/*` from `threews-x402-autonomous/1.0` (ring-duplicate-signature)

```
HTTP 502 POST /api/x402/<any endpoint>   ua: threews-x402-autonomous/1.0   (~334/day since 2026-07-09)
```

- **Source:** the x402 autonomous ring paying its own endpoints; the settle
  step fails, so the paid handler returns 502 with a settle_failed body. No
  app-level ERROR accompanies it (the handler responds, nothing crashes).
- **Root cause (diagnosed 2026-07-17):** same-priced ring payments created in
  the same tick share a blockhash and compile to byte-identical Solana
  transactions, hence the same signature. Only the first lands; the rest die
  at preflight as already-processed, surfaced by the RPC as a bare
  "Transaction simulation failed" with empty logs.
- **Triage tip:** settle_failed with empty simulation logs plus interleaved
  on-chain successes means duplicate signature, not RPC or blockhash trouble.
- **Fixed and deployed (2026-07-17):** commit `93430b4fb` adds an auto-nonce to
  `payX402` so every payment is byte-unique, and reports a precise
  `broadcast_failed:already_processed` reason via a `getSignatureStatuses`
  probe. The wave stopped on the revision carrying the fix, so the dedicated
  monitor signature (`ring-duplicate-signature-502`) has been retired from
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs); ring self-pay 5xx
  now classifies under `x402-wallets-dry-5xx` (next section), which is a
  funding shape, not this bug.
- **If this exact shape recurs** (settle_failed, empty simulation logs,
  interleaved on-chain successes) on a revision carrying `93430b4fb`, treat it
  as a regression and re-investigate the payment builder; do not fund wallets
  for it, and do not let the wallets-dry classification mask it.
- **Now watched continuously:** this wave went undetected for eight days
  because every sensor read "ring armed / discovery up" while a third of
  settles silently failed. The **x402 settlement success** subsystem
  ([api/_lib/ops/x402-settle-health.js](../../api/_lib/ops/x402-settle-health.js))
  closes that blind spot: it reads the ring's own `x402_autonomous_log`
  outcomes over a 3h window and reports the settle SUCCESS RATE, counting only
  payment-rail faults (5xx / 402 / RPC / broadcast / confirm) and excluding
  caller errors (http_400/404/405/409), benign guards (cap, low USDC), and
  downstream notes. It rolls into `/api/healthz`, `/status`, and the
  uptime-cron escalation (pages on first sight, re-pages hourly, clears on
  recovery). States: `ok` ≥ 90% settle rate, `degraded` 50-90%, `down` < 50%,
  `unknown` below 20 settle attempts in-window (a quiet ring is not a fault).
  A NEW settle-fault reason is caught automatically; a new *benign* reason that
  shows up as a fault is the one thing to teach it - add the token to the
  fault/exclusion rules in that module, the same learn-once loop as
  `KNOWN_SIGNATURES` here.

---

## 🔴 5xx storm on paid x402 routes from platform agent traffic (x402-wallets-dry)

```
HTTP 502/503 GET|POST /api/x402/*, /api/mcp   ua: threews-x402-autonomous/1.0 or threews-x402-seed/1.0
```

- **Source:** the platform's own agent economy (ring, seeders, autonomous
  buyers) paying its own endpoints while something in the settle path fails.
- **Three distinct causes look identical in the HTTP logs (2026-07-28: all
  three fired in one window). Diagnose from app logs before acting:**
  1. `npm run logs -- -s three-ws-api --app --grep "fee_wallet_below_floor" --since 1h`
     hits = the sponsor fee wallet drifted under
     `X402_SPONSOR_SOL_FLOOR_LAMPORTS`. Self-heal territory: run
     `POST /api/cron/treasury-topup`; its `reclaimIdleAgentSol` leg refunds the
     fee wallet from idle agent SOL (commit `d6a7bf2a4`). No owner money needed
     unless every reclaim source reports `at_or_below_floor` **and the run reports
     `skipped_floor_held_sol` 0**. A floor skip carries its numbers
     (`at_or_below_floor:<held><<keep>`), so a non-zero held total means the SOL is
     sitting on a platform wallet behind a configured floor, not that the fleet is
     empty; review that wallet's `minSol` before asking for capital. A
     `below_min_sweep:<excess><<min>` skip is a wallet above its keep line whose
     excess is under `ECONOMY_SWEEPBACK_MIN_SOL` (default 0.01 SOL): dust the
     sweep declines to move, released by that minimum rather than by a floor. See
     [economy-master.md](../economy-master.md) "A floor skip says whether the
     wallet is empty or fenced".
  2. `--grep "data_unavailable"` hits = paid endpoints refunding honestly (no
     charge) because no market source could answer. Since 2026-07-28
     crypto-intel prices bonding-curve pump.fun mints from the pump.fun feed
     (the sniper-intel pipeline passes `mint`), so a recurrence at volume means
     a data-source outage, not wallets.
  3. `--grep "broadcast_failed"` hits = a settle transaction failed simulation;
     the reason now keeps the simulation-log tail (the actual cause).
     `insufficient funds` on the token transfer = the ring payer's USDC float
     dipped below per-tick volume; `POST /api/cron/economy-rebalance` restores
     it (expect `results[].status: "swapped"`).
- **Symptom map:** `502` = fee wallet below its SOL floor or settle broadcast
  failed; `503` = the payer's self-pay refused or a data_unavailable refund;
  `402` from a ring agent = its buyer wallet is out of USDC.
- **The quiet variant: no storm at all, just a settle-rate collapse
  (`no_solana_accept`).** Observed 2026-07-29 16:00 UTC. The sponsor drifts
  under its floor and
  [buildRequirements()](../../api/_lib/x402-paid-endpoint.js) WITHDRAWS the
  Solana accept from every 402 challenge (`sponsorKnownBelowFloor()`), so the
  ring, which is Solana-only, never gets to attempt a payment. There is no 5xx
  storm to grep, because nothing is being rejected. The fingerprint is:
  settlements collapse (that hour: 735/h to 13/h) while rail faults stay at
  their normal level (~100/h all day), and `no_solana_accept` in
  `x402_autonomous_log` goes from exactly 0 to 300-400/h. Confirm the mechanism
  from outside the box, no logs needed:
  `curl -s https://three.ws/api/x402/three-intel | jq '.accepts[].network'`.
  Only `eip155:8453` back, no `solana:mainnet`, means the accept is withdrawn.
  Fix is the same free self-heal as cause 1 above (`treasury-topup`). Since
  2026-07-30 healthz reports this itself: `x402_settle.metrics.cause` is
  `sponsor_floor` (vs `fee_governor` when the wallet fee governor is pacing the
  window, or `rail` for real payment-rail faults) and `detail` names the
  withdrawal, so the sensor no longer points at the facilitator for a funding
  problem.
- **The third variant, and the one that reads as the quiet variant but is not:
  the accept is still advertised and every settle is REFUSED at the floor.**
  Measured 2026-09-09. `cause` is `sponsor_floor` here too and the fix is the
  same wallet, but the evidence lives in the opposite place, so check
  `metrics.mechanism` before you follow either hint:

  | `metrics.mechanism` | What is happening | Where the proof is |
  |---|---|---|
  | `accept_withdrawn` | `sponsorKnownBelowFloor()` dropped the Solana accept, so no payment is ever attempted | the 402 challenge (`/api/x402/three-intel`), NOT the facilitator: it never saw these calls |
  | `settle_refused` | the accept is on every challenge, buyers sign real payments, our facilitator turns each away at the floor gate | the facilitator's reject book: `fee_wallet_below_floor:<held><<floor>` names the wallet and both numbers |
  | `paced` | the wallet fee governor spent today's budget on purpose | `GET /api/x402/runway-lab` |
  | `gate_bypass` | a caller outside the ring signs and verifies payments the governor then refuses at settle, without asking the admission gate first (`metrics.gateBypass` counts them) | `x402_self_facilitator_log`: group the window's `verify` rows by `payer` and `amount_atomic`, then match the request logs by user agent |
  | `rail` | genuine payment-rail faults | the settle logs, per the greps above |

  `gate_bypass` was production on 2026-09-29, invisible under `x402_settle: ok, 97%`:
  43,848 of 46,375 facilitator settle attempts in 24h were `fee_runway_exhausted`,
  and 95% of them were the x402 seed cron (`threews-x402-seed/1.0`, 60 sponsor-mode
  $0.001 tips every two minutes against a budget that funded about one). The fix is
  in the caller, not the budget: funding the fee wallet only moves the line such a
  caller runs into.

  Two things the sensor deliberately does not count. Rows from pipelines that never
  pay (`UNPAID_PROBE_PIPELINES` in `api/_lib/ops/x402-settle-health.js`, today the
  external uptime monitor `reliability`) are dropped before the rate is taken: an
  unpaid HEAD probe timing out on a slow third-party host is not our rail. And an
  `http_502` cluster whose facilitator rows read `signature_already_settled` with
  a matching `ok` row for the same `tx_sig` seconds earlier is a nonce collision
  (two same-amount payments built against one blockhash), not the chain: see
  "Every payment picks its own nonce" in `docs/x402-ring-economy.md`.

  On 2026-09-09 production was `settle_refused` verbatim: **0** `no_solana_accept`,
  164 `fee_wallet_below_floor:1167627<2000000`, and 126 `http_402` recorded by the
  ring on the paid replay (a 402 there means the payment we built was rejected,
  which is why the reject book and not the challenge is the place to look). Before
  the split, that window printed `Solana accept withdrawn (0 no_solana_accept …)`,
  a clause contradicting its own counter, and told the reader not to start at the
  facilitator.
- **The loud variant: a rail-shaped storm that is really a dry sponsor
  (`InsufficientFundsForRent`).** Observed 2026-08-28. This is the quiet
  variant's opposite and it is easy to misread, because every symptom points at
  the rail. The sponsor held 0.000899107 SOL against the 0.02 SOL floor, which
  is 0.0000082 SOL of spendable headroom, less than two transaction fees, so
  every transaction it fee-paid failed at simulation:
  `sponsor_fee_unfunded:<sponsor pubkey>` on the verify path (spelled
  `simulation_failed:{"InsufficientFundsForRent":{"account_index":0}}` before
  2026-09-09, see below) and `sweep_broadcast_failed:Simulation failed ...
  account (0) with insufficient funds for rent` on the sweep path. **Account
  index 0 of a compiled Solana message is the fee payer**, so that error is
  never about the buyer's USDC: it is the sponsor being too poor to sign.

  Since 2026-09-09 the verify path gives that verdict its own reason class, so
  you can read it straight off `/api/healthz`
  (`x402.self_facilitator.verify.reject_reasons`, which groups on the token
  before the first `:`):

  | Class | Who is out of SOL | What to do |
  |---|---|---|
  | `sponsor_fee_unfunded` | our sponsor (`X402_FEE_PAYER_SOLANA`) | fund it; this is the platform's problem |
  | `payer_fee_unfunded` | the buyer's own wallet in a self-pay settle | nothing; not ours to fund |
  | `simulation_failed` | neither: some other revert | read the suffix, it carries the raw error |

  Under the old single `simulation_failed` spelling those three shared one
  bucket, and because `isRailFault()` matches `/simulation/` the platform's own
  dry sponsor was also counted as a payment-rail fault. Measured on 2026-09-09,
  that bucket sat at the top of the verify book with 1,438 rejects in 24 hours
  and every row was the sponsor.

  Why the quiet variant's guard did not catch it: `sponsorKnownBelowFloor()` was
  only ever written by `getBalance`, and all four paid Solana RPC lanes were over
  quota in the same window. `refreshSponsorFloorState()` fails open on an RPC
  error by design, so the guard never learned the sponsor was dry and the ring
  spent three hours attempting payments that could not settle: 95 attempts, 0
  settled. Since 2026-08-28 the settle path reads the verdict off the failure
  itself (`noteSponsorRentFailure()` in
  [self-facilitator.js](../../api/_lib/x402/self-facilitator.js)), which costs no
  RPC call and works precisely when the RPC is too degraded to answer one, and
  the sensor counts a fee-payer rent failure as a floor signal rather than a rail
  fault. Before that fix healthz reported `cause: rail` and its hint sent the
  reader to duplicate signatures and RPC preflight.

  **Confirm in one command, no logs needed:**
  `curl -s https://api.mainnet-beta.solana.com -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW"]}'`
  Under 20,000,000 lamports is below the floor; under ~900,000 the wallet cannot
  pay a single fee. Fix is the owner top-up below.
- **Not a code bug.** The economy-rebalance keypair crash (assigned
  `loadSignerKeypair`'s wrapper to `keypair`, read `.publicKey` of undefined)
  is fixed and live in commit `bb02839f9`. When
  `POST /api/cron/economy-rebalance` (Bearer `CRON_SECRET`) answers
  `skipped: insufficient_sol_surplus`, the wallets genuinely hold nothing to
  swap; at the 94-calls/min ring shape the burn is ~1-1.4 SOL/day.
- **Resolve (owner, money - only after all three greps above are exhausted):**
  send SOL (or USDC) to the economy master
  `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW`. The treasury-topup cron
  distributes to the engines within minutes and economy-rebalance restores the
  payer's USDC float. Recovery is visible as: rebalance returns
  `results[].status: "swapped"`, healthz `x402_settle` back to `ok`, the 5xx
  storm stops.
- **Alternative to daily funding:** throttle the ring to funded runway
  (`X402_RING_TICK_CONCURRENCY`, cadence and cap knobs on the Cloud Run
  service) so burn matches what the owner wants to spend.
- **Monitor signature:** `x402-wallets-dry-5xx` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), classified `owner`.
  It matches **any** `threews-*` user agent, because the ring calls its own paid
  routes under several: `threews-x402-autonomous/1.0`, `threews-x402-seed`,
  `threews-ring-agent/<persona>` (persona agents), `threews-x402-wallet-monitor`
  and `threews-x402-thumbnail-regen`. Matching only the first two used to leak
  the rest into `investigate` on every sweep with the same root cause.
- **NOT this class: `fee_runway_exhausted`.** A settle refused with
  `fee_runway_exhausted:<spent>+<next>><budget>` is the **wallet fee governor**
  pacing a platform wallet's daily fee burn to its funded runway - a designed
  throttle, not an outage, and no action is required. Volume resumes at UTC
  midnight or immediately when the wallet is topped up (the budget scales with
  live balance). See docs/x402-ring-economy.md "The wallet fee governor". Only
  `fee_wallet_below_floor` and `insufficient_sol_surplus` mean the wallets are
  actually dry.

  **It answers 503 `settlement_unavailable`, not 502.** Until 2026-08-06 this
  refusal was the one deliberate throttle the settle path's retryable branch
  missed, so it went out as `502 settle_failed` and read as an outage to every
  buyer, trust monitor and internal pipeline: 15,619 of the autonomous loop's
  20,030 `http_502` rows in the preceding 48 hours were this one reason. A
  `502 settle_failed` cluster is therefore now genuinely unexplained and worth
  investigating; a `503 settlement_unavailable` cluster is the governor or the
  sponsor floor, and the reason token tells you which. The autonomous loop also
  checks fee admission before it pays now, so a paced wallet shows up as
  `fee_runway_exhausted` skips in `x402_autonomous_log` rather than as failed
  paid calls.

  **The sensor reads through the status codes now.** `x402_autonomous_log` is
  reason-blind for refusals that arrive over HTTP (the row says `http_503` or,
  pre-2026-08-06, `http_502`; the reason lives only in
  `x402_self_facilitator_log.reject_reason`). Since 2026-08-07 the healthz
  `x402_settle` sensor reconciles those status-only 5xx rows against the
  facilitator book for the same window, re-attributing them to `fee_governor` /
  `sponsor_floor` before it computes the rate. So `metrics.cause` is trustworthy
  even for governed refusals recorded as bare 5xx, the settle rate judges the
  rail alone, and a `cause: "rail"` verdict now genuinely means the rail. (The
  2026-08-05 storm read `down`/`rail` at settle 26.1% under exactly this
  blindness; the same data now reads as governor pacing with a healthy rail.)

---

## 🔴 HTTP 503 on cryptocurrency.cv AI routes: `ccv-ai-providers-unavailable` / `ccv-ai-providers-unavailable-503`

```
HTTP 503 GET https://cryptocurrency.cv/api/narratives
AI provider groq unavailable (AIRateLimitError), trying next provider... rate-limited / out of quota (429)
AI provider gemini unavailable (AIAuthError) ... [403 Forbidden] Lightning dunning decision is deny for project: projects/93741856042
```

- **Service:** `cryptocurrency-cv` (serves https://cryptocurrency.cv). Source
  lives in its own repository, `nirholas/cryptocurrency.cv`, not in this one.
  Its AI routes walk one provider chain in `src/lib/ai-provider.ts`.
- **Root cause (2026-10-08 sweep): every provider is out at once, and each for
  a billing reason, not a code one.**
  - Groq: the free tier's 200k tokens/day budget is spent. Before the
    2026-10-08 fix, `/api/sentiment` re-ran a ~7k-token prompt on every poll, so
    one client polling a single asset (91 calls in 6h) spent the day's budget by
    itself.
  - Gemini and Vertex: refused with `Lightning dunning decision is deny`, a
    billing hold on project `aerial-vehicle-466722-p5` (number 93741856042). It
    reads like an IAM error and is not one; no key or role change clears it.
  - OpenRouter: both `OPENROUTER_FALLBACK_KEYS` belong to one account whose
    usage exceeds its credits. Revisions built before 2026-09-30 never even
    read that variable.
- **What users see after the 2026-10-08 fixes:** `/api/sentiment` answers 200
  from a keyword reading of the headlines (`meta.method: "keyword"`,
  `meta.degraded: true`), `/api/narratives` serves its last good analysis for
  up to an hour, and every AI route caches one analysis for five minutes, so a
  poller no longer drains the provider. A 503 now only appears on an AI route
  with nothing cached, carries `Retry-After`, and no longer echoes the
  provider's raw error (which used to include the Groq organization id).
- **Resolve (owner, billing): restore any ONE provider.** The chain recovers on
  the next request with no redeploy. Cheapest first: clear the GCP billing hold
  on `aerial-vehicle-466722-p5` (restores Gemini and Vertex, and with them the
  okx-chat-bot's Vertex lane), top up the OpenRouter account, or move
  `GROQ_API_KEY` to a paid Groq tier.
- **Confirm:** `curl -s https://cryptocurrency.cv/api/narratives` returns
  narratives, and `curl -s 'https://cryptocurrency.cv/api/sentiment' | jq .meta.method`
  prints `"ai"`.
- **Monitor signatures:** `ccv-ai-providers-unavailable` (app log) and
  `ccv-ai-providers-unavailable-503` (request log) in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), both classified `owner`.

---

## 🟡 HTTP 502 on `/api/coin/*` - `coingecko-quota-exhausted-502`

```
HTTP 502 GET /api/coin/detail?id=<coin-id>
body: {"error":"upstream_error","error_description":"coin data is unavailable right now - retry shortly"}
```

- **Source:** [api/_lib/coingecko.js](../../api/_lib/coingecko.js) `geckoFetch()`
  exhausted every rung - live fetch, in-memory stale buffer (30 min) and the
  durable Upstash last-good copy (6 h) - so the handler surfaced its 502.
- **What it usually means: the demo KEY, not the upstream.** CoinGecko's demo
  tier caps at **10,000 calls per month**. Once the cap is hit, every request
  carrying `COINGECKO_API_KEY` gets a 429 (`error_code: 10006`) for the rest of
  the billing period - while the *identical request without the key* is still
  answered by the keyless public tier. An exhausted key is therefore strictly
  worse than no key. On **2026-07-28** it took `/api/coin/detail`, `/tickers`
  and `/exchange` to a hard 502 for hours; the pages that survived only did so
  off their durable last-good copies.
- **Confirm in one call** (`$KEY` from the Cloud Run env):

  ```sh
  curl -s -H "x-cg-demo-api-key: $KEY" https://api.coingecko.com/api/v3/key
  # {"status":{"error_code":10006,"error_message":"You've reached 10,000 calls limit. …"}}
  ```

- **Self-healing since 2026-07-28.** `geckoFetch` now treats the key as a
  resource that can go bad: a keyed 401/403/429 benches the key for 15 minutes
  and immediately retries the same URL keyless, and `geckoHeaders()` (shared
  with [api/\_lib/market-fallbacks.js](../../api/_lib/market-fallbacks.js)) stops
  attaching a benched key at all. A monthly quota reset or a key upgrade
  recovers on its own with no redeploy. Pinned by
  [tests/coingecko-key-health.test.js](../../tests/coingecko-key-health.test.js).
- **Resolve:** a *lingering* 502 after that means the keyless tier is throttled
  too (Cloud Run egress IPs are shared and CoinGecko rate-limits per IP). Stop
  paying the wasted round trip, config-only and pre-approved:

  ```sh
  gcloud run services update three-ws-api --region us-central1 \
    --remove-env-vars COINGECKO_API_KEY
  ```

  Then tell the owner the key needs a paid tier (or to wait for the monthly
  reset). Re-add with `--update-env-vars COINGECKO_API_KEY=<key>` once renewed.
- **Monitor signature:** `coingecko-quota-exhausted-502` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), classified `env-action`.

---

## 🟡 HTTP 502 on `/api/pump/price-history`: `pump-price-history-upstreams-502`

```
HTTP 502 GET /api/pump/price-history?mint=<mint>&interval=15m&from=<unix>&to=<unix>
body: {"error":"upstream_error","error_description":"Price history is unavailable for this coin right now"}
```

- **Source:** [api/pump/price-history.js](../../api/pump/price-history.js)
  walked every rung (Birdeye via [api/_lib/birdeye.js](../../api/_lib/birdeye.js),
  GeckoTerminal, pump.fun candles) and held no last-good candles for the mint
  and interval.
- **Not this:** a coin with no market anywhere. Until 2026-10-08 such a coin
  could 502 here: the Birdeye rung's GeckoTerminal fallback had already been
  told "no pools", then the handler re-asked the identical URL, drew a 429 on
  the shared egress and read the throttle as an outage. The pool lookup now
  shares [api/_lib/market/ohlcv.js](../../api/_lib/market/ohlcv.js)
  `topPoolForToken()`, so that coin answers `404 no_market`.
- **What a 502 now usually means:** Birdeye is out of compute units and
  GeckoTerminal is throttled at the same moment. Confirm Birdeye:
  `curl -s -H "X-API-KEY: $BIRDEYE_API_KEY" -H "x-chain: solana" "https://public-api.birdeye.so/defi/ohlcv?address=<mint>&type=15m&time_from=<from>&time_to=<to>"`.
  `{"success":false,"message":"Compute units usage limit exceeded"}` (seen
  2026-10-08) is the plan's quota, and only the owner can reset or upgrade it.
  The chart keeps working on GeckoTerminal meanwhile.
- **Monitor signature:** `pump-price-history-upstreams-502` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), classified `env-action`.

---

## 🟢 HTTP 502 on `/api/pump/trending`, `/api/v1/pump/trending`: `pump-trending-upstreams-502` (§pump-trending-upstreams)

```
HTTP 502 GET /api/pump/trending?limit=48&rich=1
```

- **Source:** [api/pump/trending.js](../../api/pump/trending.js) reads Birdeye
  first, then falls back to the pump.fun board through the shared,
  cross-instance reader [api/_lib/pump-feed-fetch.js](../../api/_lib/pump-feed-fetch.js),
  which already retries once honoring `Retry-After` and serves a stale board
  for up to 10 minutes after both live sources fail. A 502 only fires when
  Birdeye, pump.fun, AND the stale cache are all empty at once.
- **What it means:** usually the same Birdeye compute-unit exhaustion as
  `pump-price-history-upstreams-502` landing at the same moment pump.fun's
  frontend feed is also rate-limiting the shared Cloud Run egress IP, on an
  instance cold enough to hold no stale board yet. Self-healing: the 30s live
  cache and 10-minute stale window recover on the next request once either
  upstream answers.
- **Added:** 2026-10-15 deep sweep found 2 occurrences with no app-level
  crash log, matching this exact "both upstreams down, no stale board"
  shape rather than a code fault.
- **Monitor signature:** `pump-trending-upstreams-502` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), classified `self-healing`.

---

## 🟢 HTTP 502 on `/api/pump/coin`: `pump-coin-lookup-upstream-502` (§pump-coin-lookup-upstream)

```
HTTP 502 GET /api/pump/coin?mint=<mint>&miss=empty
```

- **Source:** `handleCoin()` in [api/pump/[action].js](../../api/pump/[action].js)
  fetches `/coins/<mint>` from pump.fun and falls back to the last-good cached
  copy (`serveStaleCoin`) on any non-2xx/non-404 upstream response. A 502
  `upstream_failed` only fires when pump.fun rejects the request AND no
  last-good copy exists yet for that specific mint.
- **What it means:** confirmed 2026-10-23 by reading the app logs for the
  sampled mint: pump.fun answered with its own Cloudflare anti-bot "Just a
  moment..." challenge page (HTTP 403), not a real pump.fun-side 404 or 500.
  Self-healing: the next successful fetch repopulates the cache for that mint.
- **Added:** 2026-10-23 triage-lane sweep found 1 occurrence with no
  app-level crash log, matching the known pump.fun Cloudflare-challenge shape
  rather than a code fault.
- **Monitor signature:** `pump-coin-lookup-upstream-502` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), classified `self-healing`.

---

## 🟡 `429 Client Error … huggingface.co` → `LocalEntryNotFoundError` on a model worker - `hf-hub-rate-limited`

```
requests.exceptions.HTTPError: 429 Client Error: Too Many Requests for url:
  https://huggingface.co/facebook/dino-vitb16/resolve/main/config.json
We had to rate limit your IP (2600:1900:0:2d0e::2801).
huggingface_hub.utils._errors.LocalEntryNotFoundError: An error happened while trying to locate the file on the Hub …
ERROR:    Application startup failed. Exiting.
Container called exit(3).
Default STARTUP TCP probe failed 1 time consecutively for container "server-1" on port 8080.
```

- **Source:** a model worker whose model construction pulls a file from
  huggingface.co **at startup**. 2026-07-28 case: `model-triposr`, whose
  TripoSR `DINOSingleImageTokenizer` calls `hf_hub_download("facebook/dino-vitb16",
  "config.json")` while building the graph - the TripoSR checkpoint itself was
  already local on the gcsfuse mount, but that one 454-byte config was not.
- **What it means:** anonymous HF pulls are rate-limited **per IP**, and Cloud
  Run egress IPs are shared with the rest of the region. When HF says no, the
  app never listens on `$PORT`, the startup probe fails, and Cloud Run kills the
  revision - a crash loop that scales to zero and 503s every request. **No boot
  path may depend on a live huggingface.co fetch.**
- **The token trap:** the pinned `huggingface_hub` reads the **legacy**
  `HUGGING_FACE_HUB_TOKEN` env var. Setting `HF_TOKEN` alone changes nothing
  (verified: the retry 429'd identically).
- **Resolve (config-only, pre-approved).** Stage the file into the HF cache
  layout inside the already-mounted weights bucket, then point the worker at it.
  `<sha>` is the repo's current commit from
  `https://huggingface.co/api/models/<org>/<repo>` (field `sha`):

  ```sh
  # 1. build the cache layout locally
  SHA=$(curl -s https://huggingface.co/api/models/facebook/dino-vitb16 | jq -r .sha)
  D=hub/models--facebook--dino-vitb16
  mkdir -p "$D/refs" "$D/snapshots/$SHA"
  printf '%s' "$SHA" > "$D/refs/main"
  curl -sL -o "$D/snapshots/$SHA/config.json" \
    "https://huggingface.co/facebook/dino-vitb16/resolve/$SHA/config.json"

  # 2. stage it (the bucket is gcsfuse-mounted at /weights on every model worker)
  gsutil -m cp -r hub gs://three-ws-model-weights/hf-cache/

  # 3. point the worker at it, offline
  gcloud run services update model-triposr --region us-central1 \
    --update-env-vars HF_HOME=/weights/hf-cache,HF_HUB_OFFLINE=1,HUGGING_FACE_HUB_TOKEN=<HF_TOKEN from .env>
  ```

  Plain files work - `hf_hub_download` only checks `refs/<revision>` for the
  commit hash and then `os.path.exists()` on the snapshot path, so the blob
  symlinks a real HF cache uses are not required.
- **Monitor signature:** `hf-hub-rate-limited` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), classified `env-action`.

---

## 🟡 503 with "exceeded its quota limit for … nvidia_l4_gpu_allocation" (gpu-quota-starved)

```
HTTP 503 GET /health   (model-* service)   textPayload: The request failed because the project exceeded its quota limit for run.googleapis.com/nvidia_l4_gpu_allocation_no_zonal_redundancy
```

- **Source:** every L4 GPU engine draws from ONE regional pool
  (`NvidiaL4GpuAllocNoZonalRedundancyPerProjectRegion`, granted 3 in
  us-central1). When warm `min-instances` across the fleet pin all of them, a
  min-0 service can never allocate: every request, including the Cloud
  Scheduler health ping, 503s without an instance ever starting.
- **Resolve (env-action, pre-approved):** find the idle holder first. Measure
  real job traffic (POST requests, not liveness pings) for each warm GPU
  service over a few days; a warm L4 with zero jobs is dead weight. Free it:
  `gcloud run services update <service> --region us-central1 --min-instances=0`.
  2026-07-26 case: `model-hunyuan3d` held a warm L4 with 0 jobs in 3 days while
  `model-text2motion` 503'd for hours; freeing it brought text2motion back
  (health 200, ~14 s cold start) with no code change.
- **Quota raise:** a preference to 16 is filed and reconciling:
  `gcloud alpha quotas preferences list --project=aerial-vehicle-466722-p5`
  (`l4-no-zonal-us-central1-8`). us-east4 also holds 3 granted L4s if a lane is
  ever worth porting. Fleet map and the do-not-repeat lessons:
  [docs/ops/gcp-credits-plan.md](gcp-credits-plan.md).
- **Monitor signature:** `gpu-quota-starved` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), classified
  `env-action` (matches on the request entry's textPayload).

---

## 🟡 `Container terminated on signal 9.` on `model-trellis` (gpu-worker-sigkill)

```
WARNING  [model-trellis] The request failed because either the HTTP response was malformed or connection to the instance had an error.
WARNING  [model-trellis] Container terminated on signal 9.
```

- **Source:** an out-of-memory kill in the middle of a job. The L4 instance is
  already at Cloud Run's 32 GiB ceiling for that GPU, and Cloud Run does not
  print its usual "Memory limit of N MiB exceeded" line for these instances, so
  the bare SIGKILL is the only trace (the generic `run-oom` signature never
  fires). The 5xx just before it is whatever poll was in flight when the
  container died; the caller treats a poll error as "still running".
- **How it was proven (2026-10-08):** twelve kills in five days, every one on
  the single warm instance. The revision's memory utilization climbed in steps
  after heavy jobs and never came back (0.46, 0.56, 0.71, 0.81, 0.88, 0.91), and
  each kill landed seconds after the job log printed
  `After remove invisible faces`, i.e. inside the UV unwrap and texture bake.
  Read the curve yourself:
  ```sh
  TOKEN=$(gcloud auth print-access-token)
  curl -s -G -H "Authorization: Bearer $TOKEN" \
    "https://monitoring.googleapis.com/v3/projects/aerial-vehicle-466722-p5/timeSeries" \
    --data-urlencode 'filter=metric.type="run.googleapis.com/container/memory/utilizations" AND resource.labels.service_name="model-trellis" AND resource.labels.location="us-central1"' \
    --data-urlencode "interval.startTime=$(date -u -d '-24 hours' +%FT%TZ)" \
    --data-urlencode "interval.endTime=$(date -u +%FT%TZ)" \
    --data-urlencode "aggregation.alignmentPeriod=1200s" \
    --data-urlencode "aggregation.perSeriesAligner=ALIGN_PERCENTILE_50"
  ```
- **User impact before the fix:** the killed job and the one queued behind it
  kept a durable `running` record for 30 minutes, long after the forge client
  stopped polling, so lane failover never redispatched them
  (`forge_creations` rows ended as `task orphaned` or stuck in `generating`).
- **Fix (code, in `workers/model-trellis`):** `MALLOC_ARENA_MAX=2` plus
  `malloc_trim` after every job stop glibc hoarding freed heap per executor
  thread; the 3 GiB of staged weights in the in-memory `/tmp` are deleted once
  the model is on the GPU; an instance that has still grown past 80% of its
  limit drains and restarts between jobs ("recycling instance" in its log)
  instead of dying inside one; and every live task heartbeats its record, so an
  orphan now fails within ~3 minutes while the client is still polling and the
  forge fails it over. See `workers/model-trellis/instance_health.py`.
- **If it recurs after that deploy:** it is a regression or a new leak. Each job
  now logs `memory after job: …`; find where the step happens.
- **Monitor signature:** `gpu-worker-sigkill` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), scoped to
  `model-trellis`, classified `investigate`.

---

## 🟡 Revision never Ready on a single-GPU service: "Startup probes timed out after 4m" with no container logs

```
Ready condition status changed to False for Revision model-hunyuan3d-21-rtx-000NN-xxx with message:
Container failed to become healthy. Startup probes timed out after 4m (1 attempts with a period of 4m each).
```

- **Source:** not the probe budget and not the image. `model-hunyuan3d-21-rtx`
  runs on the RTX PRO 6000 quota, which Cloud Run enforces at **one** GPU in
  us-central1, and the serving revision holds that GPU with `min-instances=1`.
  A rolling update needs a second GPU instance for the new revision before
  traffic can move, so that instance never starts: its log shows only
  `Starting new instance` once a minute, with no container output at all, until
  the 4 minute startup window expires. Traffic stays on the old revision, so
  users are unaffected, but the change never ships. The 2026-09-18 attempt
  (revision 00002, adding `U2NET_HOME`) sat in this state for three weeks.
- **Resolve (config-only, pre-approved; ~10 minutes without this lane while the
  new instance loads, forge fails over meanwhile):** release the GPU, roll, then
  restore autoscaling. Manual scaling is a service-level setting, so neither the
  first nor the last step creates a revision:
  ```sh
  gcloud run services update model-hunyuan3d-21-rtx --region us-central1 --scaling=0
  gcloud run services update model-hunyuan3d-21-rtx --region us-central1 --update-env-vars KEY=VALUE   # or deploy the new image
  gcloud run services update model-hunyuan3d-21-rtx --region us-central1 --scaling=auto --max=1
  ```
  `workers/model-hunyuan3d/cloudbuild.hunyuan21rtx.yaml` runs this same
  sequence around its deploy, and restores autoscaling even when the deploy
  fails. Applied 2026-10-08: revision `model-hunyuan3d-21-rtx-00003-jms` became
  Ready in 35 s.
- **Monitor:** the deep sweep's fleet readiness probe (`npm run triage:gcp:deep`)
  reports the service as not Ready.

---

## 🟡 `[x402-audit] insert failed … db query exceeded 3000ms deadline`

- **Source:** [api/_lib/x402/audit-log.js](../../api/_lib/x402/audit-log.js) `logPaymentEvent`.
- **What it means:** the Neon DB is saturated, so a best-effort audit write timed
  out at its 3 s fast-fail budget. This is **fire-and-forget** - the payment was
  already decided and the response already sent (the accompanying `402` is the
  normal x402 challenge, not a failure). The log is throttled to one line/minute
  with a suppressed-count digest by design.
- **Amplification is now fixed in code.** Audit writes no longer fire one Neon
  insert per request. `logPaymentEvent` buffers each event to a Redis list and a
  once-a-minute batch flusher (`flushAuditBuffer`, drained by
  [api/cron/flush-usage-events.js](../../api/cron/flush-usage-events.js) and the
  QStash job) drains them as **one multi-row INSERT** - the same buffer→flush path
  usage events use. So a slow-DB spell no longer self-amplifies into a storm of
  concurrent single-row writes; this line now appears only if the batched flush
  itself hits a genuinely down Neon, and only when Redis is also absent does it
  fall back to the old bounded direct insert. A retention sweep in
  [api/cron/db-retention.js](../../api/cron/db-retention.js) also keeps the ledger
  trimmed (`X402_AUDIT_RETENTION_DAYS`, default 90) so the dashboard aggregates
  that scan it stay fast.
- **Resolve (owner, capacity):** the root cause is still DB headroom - scale the
  Neon compute or add a pooler so writes settle quickly. For more durability
  headroom on the direct-insert fallback, raise `X402_AUDIT_WRITE_TIMEOUT_MS`
  (500-15000, default 3000). Losing these rows loses only telemetry, never a
  payment. Ring spend status (live / paused / guard violations) is now also
  visible in `/api/healthz` under `x402.ring`.

---

## 🟡 `[cron] <name> skipped - db at storage cap (<size>MB ≥ <high-water>MB); retention will reclaim space`

```
[cron] launcher-tick skipped - db at storage cap (593MB ≥ 470MB); retention will reclaim space
```

- **Source:** [api/_lib/http.js](../../api/_lib/http.js) `wrapCron({ requireWriteCapacity: true })`, via `isStoragePressured()` in [api/_lib/db.js](../../api/_lib/db.js). Emitted by the write-heavy crons that opt into the preflight: `launcher-tick`, `coin-intel-observe`, `smart-money-rollup`, `recompute-reputation`, `intel-learn`.
- **What it means:** the Neon branch is over its high-water mark (`DB_RETENTION_HIGH_WATER_MB`, default 470). Rather than run a full write-tick that would fail per-row with SQLSTATE 53100 and flood the logs, each write-heavy cron **preflight-skips** with a single warn and a healthy heartbeat (uptime reads it as up, not stalled). [api/cron/db-retention.js](../../api/cron/db-retention.js) runs every 15 min, tightens its retention window to the floor under pressure, DELETEs + VACUUMs, and the next tick resumes once size drops back under the mark. In the 2026-07-05 export db-retention was scheduled and returning `200` (~3.5 s/run) the whole window - the valve is working; the branch is simply sitting above the mark because the live data footprint exceeds it and Neon's storage GC is not instant.
- **Check the mark against the REAL cap first (2026-07-29).** The high-water mark is a config value, not a measurement, and it has been set to a phantom cap before. Confirm both numbers before touching anything else:

  ```sh
  psql "$DATABASE_URL" -c 'SHOW neon.max_cluster_size'                                    # the real ceiling
  psql "$DATABASE_URL" -c 'SELECT pg_size_pretty(pg_database_size(current_database()))'    # the live footprint
  npm run logs -- --all --grep "project size limit" --since 7d                             # real 53100s, if any
  ```

  If `max_cluster_size` is far above the mark and there are no `project size limit` errors, the skips are **self-inflicted** and the fix is to raise the mark (config-only, pre-approved). On 2026-07-29 that read 16TB against a ~2.5 GB footprint while the mark sat at 3072, so the mark was raised to `8192`; on 2026-10-09 the footprint had reached 11.6 GB and it was raised again to `16384`. See [db-retention.md](db-retention.md#sizing-the-high-water-mark-read-before-changing-it) for the sizing rule.
- **This gate has starved the money path.** On 2026-07-28 at 18:42 the branch crossed a mark set equal to the assumed cap, and 56 crons skipped in one minute - including `economy-rebalance`, which refills the x402 fee wallet. The fee wallet then starved and every settle returned `fee_wallet_below_floor` for four hours. `economy-rebalance` is deliberately **not** gated any more; do not re-add `requireWriteCapacity` to a cron on the funding path.
- **Resolve (capacity):** the write crons stay skipped only while `pg_database_size > high-water`. In order: (a) raise `DB_RETENTION_HIGH_WATER_MB` if the real cap has headroom (the usual answer, see above); (b) raise the **Neon compute/storage plan** if it genuinely does not; (c) tighten `PUMP_INTEL_RETENTION_DAYS` / `PUMP_INTEL_MIN_RETENTION_DAYS` to shed the firehose faster. None is a code change - the gate and the valve are covered by [tests/cron-storage-backoff.test.js](../../tests/cron-storage-backoff.test.js).

---

## 🟢 `ws error: Unexpected server response: 301`

```
ws error: Unexpected server response: 301
```

- **Source:** `@solana/web3.js`'s internal `rpc-websockets` client, under the pump.fun trade firehose ([api/_lib/pump-onchain-trades.js](../../api/_lib/pump-onchain-trades.js)).
- **What it means:** an RPC lane in the shared chain serves JSON-RPC happily over **HTTP** but refuses the **WebSocket** upgrade. rpc-websockets treats every failure as transient and reconnects in a tight background loop for the life of a warm instance, so one bad lane produces ~100 identical lines an hour (measured 2026-07-29: `solana.leorpc.com` → 301, `solana-mainnet.gateway.tatum.io` → 402).
- **Already fixed - this should be self-healing now.** Each lane's socket is probed once before use, and a structural refusal (301/302/307/308, 401/402/403/404/405/410/501) benches that lane for the process while a transient one (429, 5xx, reset) benches it for 5 minutes. The bench policy is a pure function (`classifyWsFailure`) covered by [tests/pump-onchain-ws-lanes.test.js](../../tests/pump-onchain-ws-lanes.test.js). Expect at most one `ws lane benched (structural): <host>` line per lane per process instead of the storm.
- **If the storm returns:** a lane is failing in a way the classifier reads as transient when it is really permanent. Probe it directly and add its status to the structural list:

  ```sh
  curl -s -o /dev/null -w '%{http_code}\n' -m 8 \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
    https://<rpc-host>
  ```

---

## 🟢 `{"stage":"index-delegations","warning":"time-budget-exceeded","elapsedMs":…,"stoppedAtBlock":…}`

- **Source:** [api/cron/\[name\].js](../../api/cron/[name].js), the delegations indexer (`IDX_TIME_BUDGET_MS`, 22 s - a conservative per-invocation budget that checkpoints the cursor well before any request timeout).
- **What it means:** the indexer hit its per-invocation time budget mid-backfill, so it **saved the cursor at `stoppedAtBlock` and returned** rather than risk a 504. The next tick resumes exactly where it stopped. This is a checkpoint, not a failure - logged as `warning` by design. A run of these back-to-back just means the indexer is draining a block backlog (cold cursor starts a day back); it stops once the cursor catches the confirmed head.
- **Resolve:** 🟢 nothing required - it self-heals as the backlog drains. If it never stops over many hours, the RPC pool is too slow to keep pace; add a faster `IDX_RPC_URLS` endpoint or shrink the per-chain block cap so each tick makes more progress.

---

## 🟢 `[cache] redis SET failed / degraded / circuit opened … memory fallback`

- **Source:** [api/_lib/cache.js](../../api/_lib/cache.js).
- **What it means:** Upstash REST SETs are timing out (a store in a region far
  from the function region is the usual cause). The cache adapter already: fails
  fast at `CACHE_REDIS_CMD_TIMEOUT_MS`, opens a **circuit breaker** after 5
  consecutive failures, adds a **SET-suppression gate** so degraded writes skip
  Redis entirely, and **throttles** every warning to one line/minute. Reads keep
  being served; nothing is on the request critical path.
- **Resolve:** 🟢 nothing required - it self-heals when Upstash recovers (you'll
  see `redis SET recovered`). 🟡 optional: move the cache to a same-region store,
  or provision a dedicated `UPSTASH_CACHE_REST_URL/TOKEN` so best-effort cache
  writes don't contend with the fail-closed rate limiter, or bump
  `CACHE_REDIS_CMD_TIMEOUT_MS` for a distant store.

---

## 🟢 `[three-holders-snapshot] refresh deferred (transient upstream): Solana error #8100002`

- **Source:** [api/cron/three-holders-snapshot.js](../../api/cron/three-holders-snapshot.js).
- **What it means:** Helius DAS returned a 429 (rate limit). The cron classifies
  it as **transient** (via `isRpcRateLimited` on the structured status code),
  logs a `warning` not an `error`, leaves the prior good snapshot intact, and
  self-heals on the next 5-minute tick. Public reads are unaffected.
- **Resolve:** 🟢 nothing required. 🟡 if it's frequent, raise the Helius plan/quota.

---

## 🟢 `[balances] helius quota/rate-limited - skipping it … using public RPC`

- **Source:** [api/_lib/balances.js](../../api/_lib/balances.js) (and the token-market path).
- **What it means:** Helius hit `max usage reached`; the code backs off Helius for
  a few minutes and serves from the **public Solana RPC** in the meantime.
- **Resolve:** 🟢 nothing required - the public-RPC fallback is working. 🟡 raise
  the Helius quota to avoid the degraded window.
- **But do not read this line as "only Helius is affected."** It watches one
  provider; see the `rpc_lanes` section below for the whole-tier view.

---

## 🔴 Every paid Solana RPC lane exhausted at once (`rpc_lanes` degraded)

```
/api/healthz → subsystems.rpc_lanes: degraded
  "all 3 paid lanes exhausted; serving from 6 free lanes"
```

- **Source:** `checkRpcLanes()` in
  [api/_lib/ops/subsystem-health.js](../../api/_lib/ops/subsystem-health.js),
  reading `rpcLaneHealth()` from
  [api/_lib/solana/connection.js](../../api/_lib/solana/connection.js).
- **What it means:** every endpoint the platform PAYS for is parked in quota
  cooldown simultaneously, so all Solana traffic is running on free public
  nodes. The platform stays UP (that is the failover chain working), but free
  nodes are aggressively throttled, and the symptom set is diffuse and easy to
  misdiagnose: intermittent 502/503/504 on on-chain routes, `broadcast_failed`
  settles, slow balance reads, sniper and pump routes timing out.
- **Why this sensor exists.** On 2026-07-29 the Helius plan
  (`-32429 max usage reached`), QuickNode's daily cap (`-32003 daily request
  limit reached`) and Alchemy's monthly cap (`429 Monthly capacity limit
  exceeded`) were ALL exhausted at the same time, and nothing surfaced it: the
  only RPC sensor watched Helius, through per-instance memory, so a freshly
  started instance reported `premium RPC healthy` while every premium lane was
  returning errors. Verify any lane by hand with a single call:
  ```sh
  curl -s "<endpoint>" -X POST -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW"]}'
  ```
- **Resolve (owner, money):** top up or upgrade the exhausted plans (Helius,
  QuickNode, Alchemy). Nothing else clears a quota; the cooldowns simply expire
  and re-trip while traffic exceeds the free tiers.
- **Check for a scanner burning the quota before topping up.** Measured
  2026-10-08: `/api/cron/x402-ring-leak-scan`
  ([api/cron/x402-ring-leak-scan.js](../../api/cron/x402-ring-leak-scan.js))
  walked its full 2,006-wallet registry sequentially on every run, with no
  budget and no single-flight lock, fired both by its own Cloud Scheduler
  `*/10` job and by `economy-tick.js` every 2 minutes. Result: about 8
  overlapping full scans at all times, roughly 46,000 `getSignaturesForAddress`
  calls an hour from one read-only monitor, run latency p50 765s against a
  300s declared budget, and 504s on about 7% of runs. Recognize it with
  `gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="three-ws-api"
  httpRequest.requestUrl:"x402-ring-leak-scan"' --freshness=3h --limit=500
  --format='value(timestamp,httpRequest.status,httpRequest.latency,httpRequest.userAgent)'
  --project aerial-vehicle-466722-p5`: many overlapping entries with
  `userAgent` `threews-economy-tick/1.0` alongside `Google-Cloud-Scheduler`,
  and latencies in the hundreds of seconds. Fixed 2026-10-11: the handler now
  holds a lease (`acquireLock`), runs under a 200s wall-clock budget, scans
  role wallets plus ledger-active wallets plus an oldest-checked_at-first
  rotation instead of the whole registry every time, and was removed from
  `economy-tick.js`'s `TARGETS`. A healthy run now shows p50 under 60s with no
  `threews-economy-tick/1.0` caller in the log query above.
- **Do NOT "fix" it by promoting the reserve.** `SOLANA_RPC_LAST_RESORT_URLS`
  exists to keep a metered endpoint in reserve; naming that same URL in
  `SOLANA_RPC_URL` or `QUICKNODE_RPC_URL` makes it the primary (the chain
  dedupes to the first occurrence) and burns the reserve first. That exact
  misconfiguration was live until 2026-07-29. See
  [docs/solana.md](../solana.md) for the full priority contract.
- **Repointing the primary at a free node hides this sensor on older builds.**
  `checkRpcLanes()` counts whichever URL `SOLANA_RPC_URL` names as paid
  capacity, so pointing it at a keyless node during an outage makes the paid
  tier read healthy at the exact moment all of it is dark. Cross-check by
  probing each provider by hand with the `getBalance` call above before
  trusting a green `rpc_lanes` row.
- **Whole-tier runbook:** [solana-rpc-lanes.md](solana-rpc-lanes.md) has the
  one-sweep probe over every configured lane, the measured per-lane capability
  matrix (which free node refuses which method, and why PublicNode as primary
  silently breaks holder gating), the rotate-vs-fail classification contract,
  and the recovery commands.
- **Bonding-curve symptom:** `HTTP 502 GET /api/pump/curve` (and the v1 alias)
  answers `upstream_error` only after the read-only RPC/Jupiter fallback is
  exhausted. The monitor classifies an isolated occurrence as
  `pump-curve-rpc-unavailable` (self-healing). Escalate it only when it persists
  after `healthz.rpc_lanes` shows at least one healthy lane; no transaction was
  broadcast and retrying cannot spend user funds.
- **Holder-distribution symptom:** `HTTP 503 GET /api/crypto/holders` answers
  `upstream_unavailable` when both holder paths (Helius, then keyless
  `getTokenLargestAccounts`) fail for a mint with no last-good report cached
  yet (24h TTL), common for a mint nobody queried before during a lane
  outage. The monitor classifies this `holders-rpc-exhausted-503`
  (self-healing). Escalate only if it persists after `rpc_lanes` reads ok;
  [api/_lib/crypto-token-holders.js](../../api/_lib/crypto-token-holders.js)
  is the composition logic if it does.
- **Bonding-status symptom (2026-10-15 deep sweep):** `HTTP 503 GET
  /api/crypto/bonding` answers `upstream_unavailable` when the pump.fun feed
  is temporarily unreachable, the identical designed backoff contract
  `getBondingStatus()` documents in its own handler comment ("Never 500:
  answer 503 + Retry-After so the agent backs off and retries, per the
  free-API contract"). A single hit with no matching app-level error log line
  fell through to `investigate` every sweep before this signature was added.
  The monitor now classifies it `bonding-upstream-unavailable-503`
  (self-healing). Escalate only if it persists for the same mint after the
  pump.fun public frontend itself is reachable again;
  [api/crypto/bonding.js](../../api/crypto/bonding.js) and
  [api/_lib/pump-bonding.js](../../api/_lib/pump-bonding.js) are the handler
  and composition logic. Regression-covered in
  [tests/gcp-triage.test.js](../../tests/gcp-triage.test.js) ("classifies a
  bonding-curve upstream outage as self-healing").

## 🟡 HTTP timeout with no cron context

```
The request has been terminated because it has reached the maximum request
timeout
```

- **Source (pre-2026-10-11):** nothing. `maxDuration` exports on
  `api/cron/*.js` handlers were a real Vercel-enforced per-function budget;
  nothing replaced that enforcement after the 2026-07-07 Cloud Run migration,
  so a hang anywhere inside a cron handler ran unbounded until Cloud Run's own
  900s ingress timeout (`--timeout 900` in
  [server/cloudbuild.yaml](../../server/cloudbuild.yaml)) killed the
  connection. That log line carries no cron name, no elapsed time, and no
  heartbeat write, which is why `/api/cron/x402-ring-leak-scan` (see the
  `rpc_lanes` entry above) looked like a blank wall until it was traced by
  hand.
- **Fixed 2026-10-11:** `wrapCron()` in
  [api/_lib/http.js](../../api/_lib/http.js) now races every cron handler
  against its own time budget (`maxDurationMs`, wired from each file's
  `export const maxDuration * 1000`, falling back to
  `DEFAULT_CRON_MAX_DURATION_MS` (120000ms) when a handler declares none). On
  timeout it answers a clean `503 { ok: false, reason: 'cron_timeout', cron:
  '<name>', budget_ms: <n> }`, writes the heartbeat
  (`cron:heartbeat:<name>`) as `{ ok: false, timed_out: true }` so uptime
  tooling sees the tick as failed rather than stalled, and fires a single
  `sendOpsAlert` deduplicated by signature `cron:timeout:<name>`. Node has no
  generic way to preempt arbitrary in-flight async work, so the handler itself
  keeps running in the background; a late settlement after the timeout has
  already answered is a no-op (it can never overwrite the `timed_out`
  heartbeat or touch the already-sent response).
- **Read it:** `gcloud logging read 'resource.type="cloud_run_revision"
  resource.labels.service_name="three-ws-api"
  textPayload:"exceeded its"' --freshness=24h --project
  aerial-vehicle-466722-p5` surfaces the new `[cron] <name> exceeded its
  <n>ms budget, answering 503 before Cloud Run's own timeout kills the
  connection` warn line with the cron name attached. A dashboard or alert
  firing on the ops-alert signature `cron:timeout:<name>` names the exact
  handler; a bare "maximum request timeout" with no matching `cron:timeout:*`
  alert is now a sign the hang is outside `wrapCron` entirely (a non-cron API
  route, or `server/index.mjs` itself), not inside a cron tick.
- **Resolve:** treat a recurring `cron:timeout:<name>` the same as any other
  cron bug: find why that handler's own work (a slow RPC lane, an unbounded
  DB scan, a Puppeteer render) is exceeding its declared `maxDuration`, not
  by raising the budget first. Raising `maxDuration` only widens the window
  before Cloud Run's 900s kill reappears if the underlying work keeps
  growing.

---

## 🟡 `[solana-rpc] https://<host> 403`, cooling 30m, failing over

- **Source:** `cooldownMsFor()` in
  [api/_lib/solana/connection.js](../../api/_lib/solana/connection.js).
- **What it means:** depends entirely on the body, and the two cases need
  opposite responses.
  - **A real credential failure** (bad or expired key). The lane is benched for
    30 minutes and stays benched. Fix the key.
  - **A refused call shape.** Some keyless nodes answer 403 to reject ONE
    request while serving everything else. PublicNode does this for
    `getTokenAccountsByOwner` filtered by `programId`:
    `{"code":-32602,"message":"Request blocked. Details: blocked parameter: params.1.programId"}`.
- **Why it mattered:** token and USDC balance readers make that call constantly,
  so when it was sized as a 30-minute auth bench, the primary evicted itself on
  its own routine traffic and every Solana call cascaded down the chain onto the
  exhausted paid lanes. Measured 2026-07-30, this was the last remaining
  `solana-rpc` line in production after the primary was repointed.
- **Resolve:** 🟢 nothing required for the blocked-call-shape case. Since
  commit `955146961` the rotating fetch recognises the refusal and demotes
  just that (lane, method) pair (`markMethodDemotion`) with no lane cooldown
  at all, so the node keeps serving every other call shape; the exported
  `markEndpointCooldown` path still sizes a shape refusal at 30 s instead of
  the 30 min auth bench. The monitor classifies the short-cooldown line as
  `solana-rpc-policy-block` (self-healing) in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs). 🔴 for the credential
  case, rotate the key on that provider.
- **Tell them apart:**
  ```sh
  npm run logs -- -s three-ws-api --grep "403" --since 1h
  ```
  A body naming `Request blocked` / `blocked parameter` is the harmless case.
  Anything else is a key problem.

---

## 🟢 `[forge] paid TRELLIS lane unavailable (N); degrading text→3D to free NVIDIA NIM` / `nim flux failed, falling back: nim flux timed out`

- **Source:** the forge generation router.
- **What it means:** the paid TRELLIS lane returned a 402/timeout, so forge fell
  back to the free NVIDIA NIM lane, and when a specific NIM model timed out it
  fell back again. Layered fallbacks - generation keeps succeeding.
- **Resolve:** 🟢 nothing required. Tied to the same Replicate billing item above
  if you want the paid high-fidelity lane back.

---

## 🟢 `Error: Invalid name account provided` (at `@bonfida/spl-name-service` → `resolveName` in pay-by-name.js) - `sns-name-not-found`

- **Source:** [api/x402/pay-by-name.js](../../api/x402/pay-by-name.js) `resolveName()`,
  the `.sol` resolution branch calling `sns.resolve(conn, bare)`.
- **What it means:** the x402 pay-by-name resolver was asked for a `.sol` name
  that has no on-chain name account (a name that does not exist). The `await
  sns.resolve(...)` call is wrapped in `try/catch` and correctly returns `null`,
  so the caller gets a clean `404 not_found` - there is **no user impact**. The
  `ERROR` line appears anyway because `@bonfida/spl-name-service` runs several
  lookup strategies in parallel: the awaited promise rejects and is caught, but a
  sibling promise also rejects and is left un-consumed, so Node surfaces the
  orphan rejection with an async stack that still points back through
  `resolveName` → `handleResolve`. It is caught chatter, not a fault.
- **Resolve:** 🟢 nothing required. It fires on a steady low cadence from callers
  probing names that are not registered. If it ever spikes, check *who* is
  resolving (request logs for `/api/x402/pay-by-name`) rather than the resolver.

---

## 🟢 HTTP 503 `/api/community/*`, `/api/clash*` - `cc_unconfigured` (cc-unconfigured-503)

```
HTTP 503 GET /api/community/worlds   body: {"error":"cc_unconfigured","error_description":"CoinCommunities is not configured"}
```

- **Source:** every `api/community/*` and `api/clash/*` handler throws the
  designed `UnconfiguredError` 503 from [api/_lib/coin-communities.js](../../api/_lib/coin-communities.js)
  because `CC_API_KEY` is not set. Re-swept 2026-08-08: the key still exists
  nowhere, not on the Cloud Run service (checked all 200 env vars), not in
  `.env`/`.env.local`, not in Secret Manager. Nothing is crashing, and every
  surface has a designed answer for it:
  - `/worlds` fails over to the live pump.fun trending feed and tags the
    response `source: "pump-trending"`, so the world picker stays populated.
  - `/messages` renders the town's unavailable state and a locked composer
    ("Posting opens soon"); the live feed stays open.
  - `/holder-pass` drives the Play holders gate to its `unavailable` state
    ("Holder check is offline") with a working one-click path into the coin's
    open world. Before 2026-08-08 this was the one dead end: the gate showed
    the raw upstream string with retry-only actions that could never succeed.
  - `/clash/state` and `/clash/leaderboard` fail over to the same trending
    feed (since 2026-10-08), with the roster frozen per round, so the arena
    stays playable. They answer `cc_unconfigured` only when trending is down
    too, and the page then pins the battle tabs on a human message and stops
    the 5s poll.
- **Resolve (owner, credential):** provision a CoinCommunities API key
  (api.coin-communities.xyz), then:
  `gcloud run services update three-ws-api --region us-central1 --update-env-vars CC_API_KEY=<key>`.
- **Monitor signature:** `cc-unconfigured-503` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), classified `owner`.

---

## 🟢 HTTP 503 `/api/galaxy` - `watsonx_unavailable` (watsonx-unconfigured-503)

- **Source:** [api/galaxy.js](../../api/galaxy.js). The Agent Galaxy positions
  its stars with IBM Granite embeddings on watsonx.ai; without credentials there
  is no semantic space to place anything in, so it answers a designed 503 rather
  than inventing coordinates.
- **What it means:** `WATSONX_API_KEY` and `WATSONX_PROJECT_ID` (or
  `WATSONX_SPACE_ID`) exist **nowhere** - not on the Cloud Run service, not in
  `.env`, not in Secret Manager (swept 2026-07-29).
- **No broken user path.** [src/galaxy.js](../../src/galaxy.js) matches this
  exact error and renders a designed empty state ("IBM Granite isn't connected …
  once watsonx credentials are configured, the universe lights up here"), so the
  `/galaxy` page explains itself instead of failing. Nothing to fix in code.
- **Resolve (owner, credential):** provision watsonx credentials at
  `cloud.ibm.com`, then:
  `gcloud run services update three-ws-api --region us-central1 --update-env-vars WATSONX_API_KEY=<key>,WATSONX_PROJECT_ID=<id>`.
- **Monitor signature:** `watsonx-unconfigured-503` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), classified `owner`.

---

## 🟢 HTTP 503 `/health` on a model worker, UA `Google-Cloud-Scheduler` - `worker-coldstart-health-503`

- **Source:** the keep-warm Cloud Scheduler probe hitting a GPU/model worker
  (model-text2motion, model-hunyuan3d-21, model-rig, ...) while the instance is
  cold-booting. These workers stream hundreds of MB of weights before their
  server reports ready, so a probe landing in that 30-60s window gets a 503.
- **What it means:** nothing is wrong; the probe exists precisely to absorb
  this cold start so a user never pays it. Verified 2026-07-26 on
  model-text2motion: 503 at 21:xx, "text2motion ready" logged 30 seconds later.
- **Resolve:** 🟢 nothing required. Investigate only if the SAME service shows
  this across several consecutive sweeps, which means it is crash-looping
  instead of finishing boot (`npm run logs -- -s <service> --since 1h`).
- **Monitor signature:** `worker-coldstart-health-503` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), `self-healing`.

---

## 🟢 `[pump/launch-agent] send failed ... pre-broadcast simulation failed` - `pump-launch-sim-rejected`

```
ERROR  502 POST /api/pump/launch-agent
[pump/launch-agent] send failed Error: pre-broadcast simulation failed: {"InstructionError":[1,{"Custom":6015}]}
```

- **Source:** [api/pump/[action].js](../../api/pump/[action].js), action `launch-agent`. The
  handler simulates every launch transaction before broadcasting it.
- **What it means:** the simulation REFUSED a launch that would have failed
  on-chain (pump program custom errors: curve state raced another buyer,
  slippage moved, metadata rejected). That refusal protects the user's fees;
  the caller gets a clean 502 and a retry lands (2026-07-26 case: the same
  user's 201 followed within a minute).
- **Resolve:** 🟢 nothing required for isolated occurrences. Investigate if
  the 502 group on `/api/pump/launch-agent` becomes sustained or one wallet
  repeats the failure many times (then decode the specific custom error code
  against the pump program's IDL).
- **Monitor signature:** `pump-launch-sim-rejected` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), `self-healing`.

---

## 🟢 `Error: seat reservation expired.` (Colyseus, three-ws-multiplayer) - `colyseus-seat-expired`

- **Source:** `@colyseus/ws-transport` `WebSocketServer.onConnection`, on the
  `three-ws-multiplayer` service.
- **What it means:** matchmaking handed the client a seat, and the client did
  not complete the WebSocket upgrade within the reservation TTL (slow network,
  a closed tab, a mobile browser backgrounding the page mid-join). The server
  correctly refuses the stale ticket; the client's next join request gets a
  fresh seat. Observed cadence is a handful per week, which is normal churn
  for public rooms.
- **Resolve:** 🟢 nothing required. Investigate only if it spikes together
  with real "can't join" reports (then suspect load-balancer or WebSocket
  upgrade latency in front of the service, not Colyseus itself).
- **Monitor signature:** `colyseus-seat-expired` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), `self-healing`.

---

## 🟢 `Uncaught signal: 10, pid=…, tid=…, fault_addr=0.` (three-ws-redis-proxy ONLY) - `redis-proxy-srh-crash`

- **Source:** the pinned third-party image `hiett/serverless-redis-http:0.0.10`
  (SRH, the Upstash-protocol HTTP proxy in front of Redis) running as
  `three-ws-redis-proxy`.
- **What it means:** the SRH runtime aborts sporadically (observed ~3x/day) and
  Cloud Run restarts the instance. `minScale 2` keeps a warm sibling serving
  during the restart, and the API's cache layer rides the blip via its circuit
  breaker + in-memory fallback (see §cache above) - healthz `cache` stays `ok`
  through these events, so there is no user impact at the observed rate.
- **Resolve:** 🟢 nothing required day-to-day. The durable fix is bumping the
  SRH image tag on `three-ws-redis-proxy`, which changes a running binary and
  therefore waits for owner approval like any deploy. Investigate only if the
  crash rate climbs to many per hour or healthz `cache` degrades.
- **Scope note:** the monitor classifies this **only** for
  `three-ws-redis-proxy`. An identical `Uncaught signal` line from any other
  service stays `investigate` - do not generalize this signature.
- **Monitor signature:** `redis-proxy-srh-crash` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), `self-healing`
  (service-scoped via its `services` field).

---

## 🟢 `Truncated response body. Usually implies that the request timed out...` (cryptocurrency-cv ONLY): `ccv-sse-stream-timeout`

- **Source:** Cloud Run itself (`run.googleapis.com/varlog/system`), on the
  `cryptocurrency-cv` service. The service's source lives in its own
  repository, `nirholas/cryptocurrency.cv`.
- **What it means:** `/api/news/stream` is a Server-Sent Events feed. A client
  holds it open until Cloud Run's 300 s request timeout closes the response,
  and Cloud Run logs every response it closes that way. Measured 2026-10-08:
  12 of 12 sampled lines joined by `trace` to a `GET /api/news/stream` request
  that ran 300.99 to 301.00 s, about one every two minutes. Browsers'
  `EventSource` reconnects on its own, so the reader sees an unbroken feed.
- **Resolve:** 🟢 nothing required. To confirm a line, join it to its request:
  `gcloud logging read 'trace="<trace from the warning>" httpRequest:*' --freshness=24h --format='value(httpRequest.requestUrl,httpRequest.latency)'`.
  Investigate only if a trace lands on a route that is not a stream.
- **Scope note:** classified **only** for `cryptocurrency-cv`. The same line
  from any other service stays `investigate`, because there it can mean a
  handler that never finished its response.
- **Monitor signature:** `ccv-sse-stream-timeout` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), `self-healing`
  (service-scoped via its `services` field).

---

## 🟢 `Truncated response body. Usually implies that the request timed out...` (clink-fun ONLY): `clink-mcp-stream-timeout`

- **Source:** Cloud Run itself (`run.googleapis.com/varlog/system`), on the
  `clink-fun` service (serves https://paired.exchange). Its image
  (`clink/web`) builds from its own repository, not this one.
- **What it means:** `/mcp` is an MCP streamable-HTTP endpoint. A client holds
  the connection open until Cloud Run's 300 s request timeout closes the
  response, and Cloud Run logs every response it closes that way. Measured
  2026-10-11: 4 of 4 sampled lines joined by `trace` to a `GET /mcp` request
  that ran 300.99 to 301.00 s, status 200, user agent `rokmcp-collector/0.2`.
  MCP clients reconnect on their own, so this is not a dropped session.
- **Resolve:** 🟢 nothing required. To confirm a line, join it to its request:
  `gcloud logging read 'trace="<trace from the warning>" httpRequest:*' --freshness=24h --format='value(httpRequest.requestUrl,httpRequest.latency)'`.
  Investigate only if a trace lands on a route that is not `/mcp`.
- **Scope note:** classified **only** for `clink-fun`. The same line from any
  other service stays `investigate`, because there it can mean a handler that
  never finished its response.
- **Monitor signature:** `clink-mcp-stream-timeout` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), `self-healing`
  (service-scoped via its `services` field).

---

## 🔴 5xx fan-out across `/api/forge`, `/api/gpt-forge`, `/api/glb`, avatars, `/api/3d/inspect`, `/api/print/quote`, `/cdn/*`, `/api/render/*`, `/api/animations/clips/<id>`, `/api/avatar/render`, `/api/avatar/capabilities`: `r2-downstream-5xx` (§r2-downstream)

- **Source:** every route that reads or writes through
  [api/_lib/r2.js](../../api/_lib/r2.js) (`api/forge.js`, `api/gpt-forge.js`,
  `api/objects/library.js`, `api/avatars/[id].js`), the entire `/cdn/*`
  namespace (routed by `vercel.json`'s single `/cdn/(.+)` catch-all to
  [api/cdn-object.js](../../api/cdn-object.js), which always reads R2; no
  subpath is an exception), two generic caller-supplied-URL fetch tools
  (`api/print/quote.js`, `api/3d/inspect.js`, 502 `fetch_failed`) that happen
  to be fetching R2-hosted GLBs in practice because forge/gpt-forge persist
  generated models there, and (added 2026-10-12) the avatar-render family that
  fetches an avatar's own `model_url` through `fetchModel`/`getObjectBuffer`
  instead of `api/_lib/r2.js`: `api/render/animate.js` (502 `render_failed`),
  `api/render/glb.js` and `api/render/avatar-clip.js` (502, same lib), and
  GET `api/animations/[id].js` (`/api/animations/clips/<id>`, 502
  `storage_error` from `getObjectBuffer`). Added 2026-10-25: `api/avatar/render.js`
  (502 `render_failed` from `avatar-render.js`'s `renderAvatarImage`) and
  `api/avatar/capabilities.js` (502 `fetch_failed` from
  `avatar-capabilities.js`'s `inspectGlbCapabilities`), the same
  avatar.model_url fetch pattern under two more public route names.
- **What it means:** Cloudflare R2 unreachable (healthz `object_storage`
  `down`/`degraded`, tracked at
  [production-100-OWNER-ACTIONS.md](../../prompts/finish/_context/production-100-OWNER-ACTIONS.md)
  row 36) fans out into 5xx on this whole family at once with zero matching
  app-level crash logs, because each handler returns a clean upstream-failure
  status rather than throwing. Triage-lane sweep 2026-10-11 saw all nine
  original routes fire together inside the same window; the 2026-10-12 sweep
  reproduced it live for `/api/render/animate` by curling the failing
  avatar's own `model_url` (`https://pub-<account>.r2.dev/u/<owner>/<slug>.glb`)
  directly and getting the same `403` Cloudflare answers for every other
  route in this family. 2026-10-13 (order 400): this was previously described
  as a flap (many `RESOLVED` events minutes apart); re-measurement found a
  35-plus-hour unbroken `DOWN` streak since the last resolve at
  2026-10-11T06:55:05Z (60-plus hours and still ongoing by the time this note
  was written), with the public `*.r2.dev` fallback domain also edge-blocked
  (Cloudflare-branded 403) and `/cdn/*`'s own signed-read-then-public-fallback
  therefore 502ing on both legs at once. Treat a live recurrence as a
  sustained outage, not a flap, until row 36 says otherwise. Order 400 also
  added one bounded retry (200-500ms backoff, inside a single
  `gatherObjectStorageHealth()` call) so a single transient blip no longer
  pages as `DOWN`, and routed most generated thumbnail/GLB URLs returned by
  the API through `/cdn/` instead of a raw `*.r2.dev` URL, so a future
  single-leg flap (only the signed path or only the public domain degraded)
  gets `/cdn/`'s existing failover instead of no protection at all.
- **Resolve:** check healthz first:
  `curl -s https://three.ws/api/healthz | jq '.subsystems.subsystems[] | select(.name=="object_storage")'`.
  `down`/`degraded` confirms this family and the fix is the owner-side
  Cloudflare dashboard check in row 36. If `object_storage` reads `ok`,
  stop treating this as one signature and read the specific route's handler:
  the R2-direct routes point at a real credential/bucket problem, the
  fetch-tool and avatar-render routes point at whatever host the sample URL
  actually names (confirm it is really `.r2.dev` before blaming R2).
- **Monitor signature:** `r2-downstream-5xx` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), classified `owner`.
  Regression-covered in
  [tests/gcp-triage.test.js](../../tests/gcp-triage.test.js) ("classifies an
  animated-render R2 fetch failure..." / "...a clip-detail R2 fetch
  failure..." / "...an avatar-render R2 fetch failure..." / "...an
  avatar-capabilities R2 fetch failure...").
- **Worker-side app-log variant (same outage, different shape):** a GPU/mesh
  worker that routes a caller-supplied model URL through
  `worker_security.py`'s `fetch_remote_bytes` (`remesh-service` confirmed
  2026-10-15; any worker vendoring that module can hit it) logs a Python
  traceback ending in `httpx.HTTPStatusError: Client error '403 Forbidden'
  for url 'https://pub-<account>.r2.dev/...'` when the fetched model lives on
  R2's public `.r2.dev` domain during the flap. The worker already catches
  this cleanly (`safe_error` marks the task `failed` with an opaque message;
  the traceback is logged for operators only, not an unhandled crash). This
  also exposed a real bug in the monitor itself: `buildFindings` was cutting
  its app-log classification sample to the first 400 bytes of the message, so
  the one line that names the fault in a multi-frame traceback (always last)
  never reached `classify()`, and every such hit fell through to
  `investigate` instead of this already-tracked `owner` signature. Fixed
  2026-10-15 with a `headTail()` helper that keeps both ends of an
  over-budget message. Regression-covered in
  [tests/gcp-triage.test.js](../../tests/gcp-triage.test.js) ("classifies a
  GPU worker R2 .r2.dev 403 traceback as the r2-downstream family").

---

## 🟢 HTTP 503 `/api/trenches`: `pulse-not-deployed-503` (§pulse-not-deployed)

- **Source:** [api/trenches.js](../../api/trenches.js), a read-only proxy to
  the `services/pulse` market-intelligence service over `PULSE_URL`.
- **What it means:** `pulse` has never been deployed (`gcloud run services
  list` has no `pulse` entry, `PULSE_URL` is unset), so every request answers
  the designed 503 `pulse_offline` ("Pulse is not configured on this
  deployment"). Nothing in code is broken.
- **Resolve (owner, deploy):** stand up the `pulse` Cloud Run service (its own
  Cloud SQL `DATABASE_URL`, dedicated `SOLANA_WS_URLS`) per the "Deploy
  (owner-gated)" section of [docs/trenches.md](../trenches.md). Until then,
  🟢 nothing required.
- **Monitor signature:** `pulse-not-deployed-503` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), classified `owner`.

---

## 🟡 HTTP 503 `/api/health`: `wallet-rollup-503` (§wallet-rollup)

- **Source:** [api/health.js](../../api/health.js) via
  [api/_lib/health-probes.js](../../api/_lib/health-probes.js)'s
  `gatherHealth()`, which folds exactly four probes (`database`, `rpc`,
  `worker`, `wallet`) and answers 503 on the worst one.
- **What it means:** read the body
  (`curl -s https://three.ws/api/health`) to see which probe is `down`. If it
  is `wallet` with `three_token_rail` down, that is
  `THREE_TREASURY_WALLET`/`THREE_REWARDS_WALLET` staying unset by design (row
  23: a wallet-naming decision only the owner can make, because the rewards
  candidate wallet is also the buyback signer). If it is `rpc`, that is the
  paid Solana RPC lane exhaustion (row 24, see "Every paid Solana RPC lane
  exhausted at once" above).
- **Resolve:** nothing to fix in code unless a probe other than
  `wallet`/`rpc` is the one reporting `down`; those two are both pre-existing
  owner decisions.
- **Monitor signature:** `wallet-rollup-503` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), classified `owner`.

---

## 🔴 5xx on `/api/vision`, `/api/tts/synthesize`, `/api/v1/ai/text-to-3d`: `three-ws-ai-providers-unavailable-5xx` (§three-ws-ai-providers-unavailable)

- **Source:** `/api/vision`, `/api/tts/synthesize` and `/api/v1/ai/text-to-3d`
  each walk a provider chain (NVIDIA, then Vertex Gemini, then OpenAI) and
  answer an honest 502/503 when every rung fails. Mirrors
  `ccv-ai-providers-unavailable-503` above, for this repository's own AI
  routes. `/api/v1/ai/text-to-3d` pins the NVIDIA NVCF TRELLIS rung
  specifically (added 2026-10-15 after a deep sweep found 3 `lane_error` 502s
  with no app-level crash log, matching this family).
- **What it means:** the GCP billing hold ("Lightning dunning decision is
  deny") on `aerial-vehicle-466722-p5` blocks the Vertex/Gemini rung (row 20)
  and the OpenAI key is dead (row 6), leaving only the NVIDIA rung, which the
  `forge_generation` health sensor shows intermittently failing on free-tier
  NVCF capacity.
- **Resolve (owner, billing/credential):** restoring either billing-held
  provider clears this family. Nothing to fix in code: same pattern as
  `ccv-ai-providers-unavailable-503`, just a different repository's routes.
- **Monitor signature:** `three-ws-ai-providers-unavailable-5xx` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), classified `owner`.

---

## 🔴 HTTP 503 `/api/chat`: `chat-fallback-chain-exhausted-503` (§chat-fallback-chain-exhausted)

- **Source:** `/api/chat`'s failover chain (groq, then every openrouter
  sibling, then nvidia, then the `vertex-gemini` anchor) answers 503
  `rate_limited` only once every rung including the anchor has failed
  ([api/chat.js](../../api/chat.js), the final branch around line 936). The
  `vertex-gemini` anchor is deliberately exempt from the fallback cooldown and
  the `MAX_FALLBACK_ATTEMPTS` cap specifically so a healthy anchor should never
  let chat 503 (see `buildFallbackChain` in the same file).
- **What it means:** added 2026-10-24 after a deep sweep found 21 `/api/chat`
  503s in 6h. Traced one occurrence end to end via `npm run logs`: groq 429,
  every openrouter sibling 429, nvidia 404 ("Function ... Not found for
  account"), then the vertex-gemini anchor 403 on the same GCP billing dunning
  hold ("Lightning dunning decision is deny" on `aerial-vehicle-466722-p5`,
  row 20) that blocks the anchor for `three-ws-ai-providers-unavailable-5xx`
  above. With the anchor itself billing-blocked there is nothing left to fail
  over to. The nvidia 404 is a separate, narrower signal: that `NVIDIA_API_KEY`
  account has lost access to the configured NIM function server-side (not a
  stale model id in this repo; the model string is unchanged and groq's prior
  429 already shows free-tier demand, not a routing bug, is the bottleneck).
- **Resolve (owner, billing/credential):** restoring the Vertex billing hold
  (row 20) clears this family the same way it clears
  `three-ws-ai-providers-unavailable-5xx`. Separately, check the NVIDIA NIM
  account behind `NVIDIA_API_KEY` at the build.nvidia.com console if the 404
  "Not found for account" line persists; that is an upstream account-state
  check, not a code fix. Nothing to fix in code unless a *new* rung (not
  groq/openrouter/nvidia/vertex-gemini) is the one failing.
- **Monitor signature:** `chat-fallback-chain-exhausted-503` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), classified `owner`.

---

## 🔴 HTTP 502 `/api/3d/generate`: `forge-image-ladder-exhausted-502` (§forge-image-ladder-exhausted)

- **Source:** `/api/3d/generate` self-calls `/api/forge`, whose reference-image
  step ([api/_lib/forge-reference-image.js](../../api/_lib/forge-reference-image.js))
  tries Vertex, then falls through to the text-to-image ladder
  ([api/_mcp3d/text-to-image.js](../../api/_mcp3d/text-to-image.js)): NIM FLUX,
  HF fal-ai, HF nscale, keyless Pollinations, Replicate. A 502 means every rung
  the request reached failed.
- **What it means:** root-caused on 2026-10-12. Vertex 403s on the GCP billing
  dunning hold (row 20); HF fal-ai and HF nscale both 402 "no remaining
  credits" (a separate credit pool from the LLM lanes' `HF_TOKEN` usage in
  row 6, needs its own funding, see OWNER-ACTIONS). Before the 2026-10-12 fix
  ("stop the Vertex billing hold and HF credit exhaustion from re-paying their
  own timeout on every image request"), none of those three dead lanes had a
  circuit breaker, so every request re-paid their full timeouts before ever
  reaching Pollinations, often blowing the shared ladder budget before
  Pollinations ran at all, which is what turned an owner-gated billing/credit
  issue into a request-killing 502 storm instead of a quiet fallback to the
  free lane.
- **Resolve (owner, billing/credential):** fund the Vertex billing hold (row
  20) and/or top up the HF Inference Providers credit balance (fal-ai,
  nscale). Either one clears most of this family; both together clear it.
  Nothing further to fix in code unless a *new* rung fails, or Pollinations
  itself starts failing with no paid Replicate token configured as a backstop:
  check `npm run logs -- -s three-ws-api --app --since 1h --grep "falling
  back"` for which rung is actually down before assuming it is the same two
  causes above.
- **Monitor signature:** `forge-image-ladder-exhausted-502` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), classified `owner`.

---

## 🟢 HTTP 502 `/api/kol/trades`: `kol-trades-upstream-502` (§solana-rpc)

`api/kol/trades.js` answers a designed 502 with `Retry-After: 15` when `fetchKolTrades()` fails and no last-good copy exists for the mint. It fires in the same bursts as the holders 503 while every Solana RPC lane cools down (healthz `rpc_lanes`). No action; investigate only if it persists after `rpc_lanes` reads ok.

## 🟢 HTTP 502 `/api/social/sentiment-pulse`: `sentiment-pulse-pumpfun-502` (§pump-trending-upstreams)

By design (`api/social/sentiment-pulse.js`): a pump.fun outage with no caller-supplied texts answers 502 `upstream_unavailable`. Recovers when pump.fun answers.

## 🟢 HTTP 5xx on `three-ws-redis-proxy`: `redis-proxy-upstash-timeout` (§redis-proxy)

2026-10-23 22:33Z burst: the proxy's `GenServer.call` to Upstash timed out (`SET rpccool:v1`). The API's cache and rate limiter fall back to Postgres/in-memory and healthz `cache` stays ok, so nothing user-facing breaks. Investigate only if it outlasts a burst. See also `redis-proxy-srh-crash` and the optional dedicated cache store in the owner checklist.

## 🟢 HTTP 503 `/api/agents/<id>/solana/networth`: `agent-networth-rpc-unavailable-503` (§solana-rpc)

- **Source:** `handleNetWorth()` in
  [api/agents/solana-wallet.js](../../api/agents/solana-wallet.js). Its
  hold-last-state contract serves a stale last-known-good snapshot when a
  live balance read fails; this 503 fires only when there is no snapshot to
  fall back to yet, meaning every RPC path is down for a wallet this endpoint
  has never read successfully.
- **What it means:** same root cause as `holders-rpc-exhausted-503` above
  (see "Every paid Solana RPC lane exhausted at once"), a different route
  hitting the same quota exhaustion (row 24). The handler returns 503 with
  `Retry-After: 15` rather than inventing a balance.
- **Resolve:** check healthz `rpc_lanes`/`helius` first; this fires in the
  same bursts as `holders-rpc-exhausted-503` while every paid Solana RPC lane
  cools down. Investigate only if it persists after `rpc_lanes` reads `ok`.
- **Monitor signature:** `agent-networth-rpc-unavailable-503` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), `self-healing`.

---

## 🟡 HTTP 5xx `cryptocurrency-cv` `/api/whales`: `ccv-whales-500` (§cryptocurrency-cv-separate-repo)

- **Source:** `cryptocurrency-cv`'s `/api/whales`. Its source lives in its own
  repository (`nirholas/cryptocurrency.cv`), not this one, so a crash there
  cannot be fixed from this checkout regardless of root cause.
- **What it means:** root-cause with
  `npm run logs -- -s cryptocurrency-cv --errors --app --since 6h`. If the
  cause matches the already-tracked AI-provider billing hold (see
  §ccv-ai-providers-unavailable above), no further action here; otherwise
  file it against the `cryptocurrency.cv` repository.
- **Resolve:** out of scope for this repository by design. Scoped to
  `status >= 500` only; a 429 on the same route falls back to the default
  `self-healing` classification, not this signature.
- **Monitor signature:** `ccv-whales-500` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), classified `owner`.

---

## 🟢 WARNING `invalid_permit2_spender` on `sperax-x402-facilitator`: `sperax-facilitator-invalid-permit2-spender`

- **Source:** `sperax-x402-facilitator`, a third-party-operated Cloud Run
  service in this GCP project. `gcloud run services describe
  sperax-x402-facilitator` shows `creator`/`lastModifier` `nich@sperax.io` and
  an image built outside `three-ws-build@`; its source is not in this
  repository.
- **What it means:** a caller presented a Permit2 spender address the
  facilitator does not recognize for the asset/network pair, a client-side
  integration mismatch. The facilitator answers the caller with the
  verify-failed result itself; this is not a crash and needs no retry on our
  side.
- **Resolve:** 🟢 nothing required here. If x402 settle volume through this
  facilitator drops, forward the sample payload to `nich@sperax.io`.
- **Monitor signature:** `sperax-facilitator-invalid-permit2-spender` in
  [scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs), classified `owner`,
  scoped to `sperax-x402-facilitator`.

---

## The owner runbook - every fix as an exact command

Everything red/yellow above, condensed to the actions only the owner can take,
each reduced to a copy-paste command. Nothing here is a code change - the code
paths behind every line are already hardened and covered by tests
([tests/x402-ring-invariants.test.js](../../tests/x402-ring-invariants.test.js),
[tests/cache-circuit-breaker.test.js](../../tests/cache-circuit-breaker.test.js),
[tests/cache-store-routing.test.js](../../tests/cache-store-routing.test.js),
[tests/cron-storage-backoff.test.js](../../tests/cron-storage-backoff.test.js)).
Apply the env writes to the `three-ws-api` Cloud Run service with
`gcloud run services update`; each write rolls out a new revision, so they take
effect as soon as that revision is serving traffic.

### 1. 🔴 World - stop every visitor having build rights (do this first)

The fail-closed patch ([deploy/world/patches/0003-fail-closed-without-admin-code.patch](../../deploy/world/patches/0003-fail-closed-without-admin-code.patch))
is already in the repo; it just isn't live on the running revision. One script
generates the secret, rebuilds, redeploys, and polls `/status` until it reports
`protected:true` (needs Cloud Run / Secret Manager / Cloud Build on project
`aerial-vehicle-466722-p5`):

```bash
bash deploy/world/apply-hardening.sh   # prints the admin code once - store it in a password manager
```

### 2. 🔴 x402 ring - pause cleanly, or finish arming

```bash
# Pause quietly (recommended unless you're actively going live) - kills the hourly guard alert:
gcloud run services update three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 --update-env-vars X402_AUTONOMOUS_ENABLED=false
# …or finish arming (moves real USDC) per docs/x402-ring-economy.md guard-env section.
```

### 3. 🟡 Neon - stop the write-crons preflight-skipping at the storage cap

DB sat at 593 MB vs the 470 MB high-water in the 2026-07-05 export, so
`launcher-tick`, `coin-intel-observe`, `smart-money-rollup`, `recompute-reputation`,
and `intel-learn` were skipping. Pick the lever that matches your Neon plan:

```bash
# (a) If your branch's real cap is well above 470 MB, raise the high-water to match
#     (must stay under the real Neon cap):
gcloud run services update three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 --update-env-vars DB_RETENTION_HIGH_WATER_MB=900
# (b) …or shed the pump.fun firehose faster (keeps the branch smaller):
gcloud run services update three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 \
  --update-env-vars PUMP_INTEL_RETENTION_DAYS=7,PUMP_INTEL_MIN_RETENTION_DAYS=2
# (c) Best durable fix: bump the Neon compute/storage plan in the Neon dashboard.
```

### 4. 🟡 Replicate - restore the paid forge lane (clears the two 502s)

Add credit at `replicate.com/account/billing`. The free NVIDIA NIM + HF lanes
keep serving meanwhile; paid credit brings back the high-fidelity TRELLIS lane.

### 5. 🟡 Upstash / Helius - kill the redis-timeout and 429 warnings (optional)

```bash
# A same-region dedicated cache store ends the 'redis SET failed' flood:
gcloud run services update three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 \
  --update-env-vars UPSTASH_CACHE_REST_URL=<url>,UPSTASH_CACHE_REST_TOKEN=<token>
# …or just give a distant store more headroom:
gcloud run services update three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 --update-env-vars CACHE_REDIS_CMD_TIMEOUT_MS=5000
# Helius 429s: raise the plan/quota in the Helius dashboard (public-RPC fallback covers the gap).
```
~~~~

