# Fact-checker benchmark ranks evidence by source quality, runs on its cron against live sources, and publishes a verifiable accuracy score

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/754-plan-factcheck-benchmark-evidence-ranking-and-publish.md`.

**Priority:** P2, new capability with clear value (score 40 of 100 inside the tier). **Area:** factcheck. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The fact-checker agent has a benchmark script and a cron but no published, trustworthy accuracy number, and its evidence retrieval (`search-sources.js`) returns passages without ranking them by source reliability. A check that cites a weak page as strongly as a primary source undermines the product claim. A measured, reproducible score on a fixed labelled claim set, shown on the agent's page and tracked over time, is both a quality gate and marketing proof.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Present: `scripts/fact-check-benchmark.mjs`, `api/cron/fact-check-benchmark.js`, `agents/fact-checker/src/search-sources.js`, degradation and Wikipedia-passage tests.
- Verify in Step 0 what the cron stores and where (table/cache), whether results are served at an endpoint or page, and whether the claim set is labelled with ground truth and sources (no invented labels).
- Not found: any source-reliability ranking in `search-sources.js` (confirm with grep).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
sed -n 1,60p scripts/fact-check-benchmark.mjs
grep -n -iE 'rank|score|reliab|domain|weight' agents/fact-checker/src/search-sources.js | head -20
sed -n 1,50p api/cron/fact-check-benchmark.js
grep -rn 'fact-check-benchmark' vercel.json data/pages.json api --include=* -l | head
node --test tests/fact-check-degradation.test.js tests/fact-check-wikipedia-passages.test.js 2>&1 | tail -6
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Evidence ranking: in `search-sources.js` add a pure `rankEvidence(passages)` that orders by source tier (primary/government/peer-reviewed/major encyclopedia over blogs and social), recency where the claim is time-bound, and agreement across independent domains (dedupe same-domain). Tier table lives in a data file with tests; no per-claim hardcoding. Test first: `tests/fact-check-evidence-ranking.test.js` with real captured passages showing a blog outranking a primary source under current code (fails), then fix.
2. Benchmark set: ensure the claim set is real, labelled (true/false/unverifiable) with a cited authority per label, stratified by topic, and kept in the repo under `agents/fact-checker/benchmark/`. Report accuracy, macro-F1, abstain rate and citation validity (cited URL actually contains the quoted evidence, verified by fetch).
3. Cron: make the cron run the benchmark on live sources within its time budget (shard across ticks if needed), persist each run (date, git sha, scores) and expose `GET /api/fact-check/benchmark` returning latest and history. Failure to reach a source is a recorded degradation, never a silent score drop.
4. Show the latest score and trend on the fact-checker agent page or `/docs` with designed loading (skeleton), empty ("no run yet") and error states; verify in a browser.
5. Docs: `agents/fact-checker/README.md` methodology; changelog entry; `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node --test tests/fact-check-evidence-ranking.test.js` passes and failed before the change.
- [ ] `curl -s https://three.ws/api/fact-check/benchmark` (local dev server before deploy) returns latest score with n, accuracy, citation validity.
- [ ] Page section renders all three states in a browser with no console errors.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Search provider key missing | Use the keyless sources already in `search-sources.js` (Wikipedia etc.) and record which lanes ran. |
| Cron exceeds time budget | Shard the claim set across ticks via `wrapCron` budget helpers. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/754-plan-factcheck-benchmark-evidence-ranking-and-publish.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `754-plan-factcheck-benchmark-evidence-ranking-and-publish.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

Code and config the reviewer cited alongside these docs (read them in the repo; they are not copied here): `scripts/fact-check-benchmark.mjs`, `agents/fact-checker/src/search-sources.js`, `api/cron/fact-check-benchmark.js`, `tests/fact-check-degradation.test.js`, `tests/fact-check-wikipedia-passages.test.js`.

### `docs/fact-check.md` (section "Running the benchmark")

~~~~markdown
## Running the benchmark

A published accuracy figure is only worth what its run date is worth, so the benchmark is designed to be re-run by anyone with the service key, not only by whoever first set it up.

### Where a run is stored

Two places, read in this order by `GET /api/fact-check-benchmark`:

1. **The database** (`app_settings`, key `fact_check_benchmark:latest_run`). Written by a `--publish` run or by the weekly cron. This wins, so a new run reaches the public page immediately with no deploy.
2. **`data/_generated/fact-check-benchmark.json`**, committed and baked into the image. The fallback when nothing is published or the DB is unreachable, so an outage degrades to the last shipped run instead of an empty page.

The response's `source` field says which one answered (`database` or `image`).

### Scheduled re-run

`/api/cron/fact-check-benchmark` runs the suite weekly (Mondays 04:41 UTC, see `vercel.json`) in-process on Cloud Run, against the real chain with the Redis verdict cache disabled, and publishes to the DB. No credential is needed for this path: it calls the chain directly, below the x402 payment layer. Tune with `FACT_CHECK_BENCHMARK_CONCURRENCY` (default 6) and `FACT_CHECK_BENCHMARK_DEADLINE_MS` (default 240000, kept under Cloud Scheduler's 320s attempt deadline). The handler declares `maxDuration = 300` and passes it to `wrapCron` as `maxDurationMs`, so the cron answers its own clean 503 at 300s instead of `wrapCron`'s 120s default.

### Running it by hand

```bash
# Scores the deployed endpoint and publishes the result to the live page.
node --env-file=.env scripts/fact-check-benchmark.mjs --publish
```

Drop `--publish` to write only the local file (takes effect on the next deploy). `FACT_CHECK_ENDPOINT` targets a different deployment; `--in-process` runs the chain in-process instead of over HTTP, which needs the search and LLM credentials locally.

One caveat specific to the HTTP path: it goes through the deployed endpoint, so it shares production's 7-day verdict cache. A second run inside that window re-reads the first run's verdicts for any claim that was cached, which measures the cache rather than the chain. The in-process paths (`--in-process` and the cron) disable the cache for the duration of the run and do not have this problem, which is why the scheduled run is the authoritative producer. The `endpoint` field on every report records which path produced it.

### The payment bypass

The runner's HTTP path calls the paid endpoint 40 times, which the 3-per-day free lane cannot cover, so it needs one of the two bypasses in `api/_lib/x402/access-control.js`:

- **`INTERNAL_API_KEY`** (what the published runs use). The internal service key, sent as the `X-API-Key` header. It lives as a plain env var on the `three-ws-api` Cloud Run service and mirrored in `.env`. Rotate it by generating a new value, updating the service, and updating `.env`:
  ```bash
  KEY="three_ws_internal_$(openssl rand -hex 24)"
  gcloud run services update three-ws-api --region us-central1 \
    --project aerial-vehicle-466722-p5 --update-env-vars "INTERNAL_API_KEY=$KEY"
  ```
  Use `--update-env-vars` (merges), never `--set-env-vars` (replaces the whole set). Every bypassed call is logged to `x402_access_log` with caller `internal`.
- **`FACT_CHECK_BYPASS_TOKEN`**, an OAuth bearer carrying the `x402:bypass` scope, sent as `Authorization: Bearer`. Use this when you want a scoped, per-user credential rather than the service key.

A self-serve Premium pass key does not bypass this route: pass keys are scoped to `PREMIUM_PASS_ROUTES` (the archive search) and fall through to the normal 402 here.

With neither, the runner exits before spending a run and writes nothing.

### Why a run can be refused

Two guards keep a bad run from becoming a published number:

- **Errored-claim ceiling.** Above 10% unreachable claims the run measured provider availability, not verdict accuracy. Nothing is written and the previous run stays up.
- **Degraded checks count as errors.** The chain does not throw when its LLM providers are exhausted: stance extraction falls back to all-neutral and every claim resolves to `insufficient`. That would publish roughly 25% as the product's accuracy with zero apparent errors. Both runners read the `degraded` field on the response and count such a check as unreachable, which is what makes the ceiling above fire during an outage.
- **An answer nobody could read counts too.** A provider can reply and still leave the stage with nothing usable, which lands on the same all-neutral fallback while looking like a healthy check. Both LLM stages now say so (`stance extraction unreadable`, `query generation unreadable`) instead of returning a silent `insufficient`, so the ceiling fires on a parsing fault exactly as it does on an outage, and `checkClaim()` keeps the result out of the 7-day cache rather than pinning a wrong verdict on a checkable claim for a week.
~~~~

### `docs/ops/ISSUES.md` (section "Open")

~~~~markdown
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
~~~~

### `prompts/finish/_context/roadmap-00-README.md` (section "Runnable work orders (paste one into a fresh chat)")

~~~~markdown
### Runnable work orders (paste one into a fresh chat)

| File | Owns | State |
|---|---|---|
| [generation-suite.md](../009-roadmap-generation-suite.md) | Meshy and Tripo class parity, and production truth for every generation endpoint | Open. Step 0 and tasks 1 and 2 are done (2026-09-03): the truth table was rebuilt from live probes, and every row is green except the undeployed talking-avatar lane. That sweep found the default free image lane failing 44 of 49 generations for 12 hours while every status surface read green; it is restored and hardened, and `trellis_selfhost` now has a live health probe. Tasks 3 to 8 (pipeline tools in `/forge`, preview then refine, export formats, PBR controls, job webhooks, community gallery) are untouched. |
| [developer-resources-repos.md](roadmap-developer-resources-repos.md) | The public examples satellite repo and its one-way export | Done, retired 2026-09-03. `npm run export:satellites` stages 72 files and passes all four smoke stages; the docs, `llms.txt` and `llms-full.txt` cross-links are live. Only the owner-gated publish remains (create the `three-ws` org, run the printed push), tracked as row 16 of [production-100-OWNER-ACTIONS.md](production-100-OWNER-ACTIONS.md). |
| [native-widgets.md](../916-roadmap-native-widgets.md) | Native widgets on the Android, Windows, macOS and iOS home screens | Built, all four surfaces. Android and Windows are live in production; the Apple sources are in `apple/`. Open only on what code cannot do: an Apple Developer account to sign the two binaries (owner action 17) and a Windows 11 machine for the in-board check, which wants a deploy carrying 2026-09-09's Adaptive Card fix. Whether a given origin carries it is no longer a guess: `npm run check:windows-widget:live` binds the deployed card with the deployed worker in the board's own engine. **It went green against production on 2026-09-10**, all 16 checks including the deployed card, worker and state bindings, so the Windows half is now waiting only on a human with a Windows 11 machine rather than on a deploy. It is registered in `data/guards.json` and `docs/guards.md` as of 2026-09-09, so the next agent finds it from the guard registry instead of from this pack. |
~~~~

