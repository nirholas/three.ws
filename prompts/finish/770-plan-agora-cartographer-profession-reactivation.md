# Agora citizens work as cartographers again, with diorama compose running inside the job budget

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/770-plan-agora-cartographer-profession-reactivation.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 30 of 100 inside the tier). **Area:** agora. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Agora citizens advertise seven working professions; the eighth, cartographer (capability bit 3), is fully written in `workers/agora-citizens/work/cartographer.js` but deliberately left out of `WORK_RUNNERS` because `/api/diorama` `compose` decomposes a scene with an LLM chain whose latency overruns the job budget. Until compose fits the budget, jobs requiring that capability can never be completed by any citizen, and the profession is a hole in the civilization's skill set. Activating it adds a visible, high-signal product (every citizen map is a shareable world, with a verifiable receipt) and exercises the diorama lane. The fix is to solve the latency problem and then enable the runner, not to rewrite it. The note in `workers/agora-citizens/work/index.js` says re-activation is a one-line re-add once the route runs in budget.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `WORK_RUNNERS` in `workers/agora-citizens/work/index.js` holds 7 professions; a comment block explains the cartographer omission.
- `workers/agora-citizens/work/cartographer.js` is complete: it calls `POST /api/diorama` `{action:'compose', prompt}` through `httpJson` in `work/_skills.js` (optional `signal`, no default timeout), validates the plan and returns a deliverable.
- `api/diorama.js` routes `compose` to `composePlanFromPrompt` in `api/_lib/diorama-build.js`. The `three-ws-api` Cloud Run request timeout is 900 s, so the budget in question is the citizen's job window, not the service.
- Tests present: `tests/agora-work-proof.test.js`, `tests/agora-worker-image.test.js`; none exercises the cartographer runner (re-check with `grep -rn -i cartographer tests workers/agora-citizens`). The worker has its own test suite, and worker modules vendored per worker must stay byte-identical (`npm run check:vendored`).
- Task docs `docs/agora/tasks/04-professions.md` list the professions and acceptance, `03-task-supply.md` defines task templates and prices, and `00-INDEX.md` tracks status. Compose latency has not been measured by the reviewer.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
sed -n 1,80p workers/agora-citizens/work/index.js
sed -n 1,60p workers/agora-citizens/work/cartographer.js
grep -n "taskDeadlineSecs\|WORK_TIMEOUT\|workBudget" workers/agora-citizens/*.js workers/agora-citizens/work/*.js | head
grep -rn -i "cartographer" tests workers/agora-citizens --include=*.js -l
ls workers/agora-citizens; head -30 workers/agora-citizens/package.json
grep -n "Cartographer" docs/agora/tasks/04-professions.md | head
node --input-type=module -e "import {composePlanFromPrompt} from './api/_lib/diorama-build.js'; for (const p of ['a lonely lighthouse on a stormy cliff','a cozy campsite in a pine clearing at dusk']) { const t=Date.now(); try { const r=await composePlanFromPrompt(p); console.log(p, Date.now()-t,'ms', Object.keys(r||{})); } catch(e){ console.log('fail', e.message, Date.now()-t); } }"
```

Also time real `POST https://three.ws/api/diorama` `{"action":"compose","prompt":"..."}` calls on the public lane. Record p50 and p95 over at least 10 runs before choosing a path below.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Measure compose latency (Step 0) and write the numbers and the worker's per-task budget into the order report, `workers/agora-citizens/work/README.md` and the Cartographer entry in `docs/agora/tasks/04-professions.md`.
2. Pick the in-budget path from the data. If p95 fits the citizen job window with headroom, just add a per-call timeout and re-enable. If not, either (a) add a fast compose lane: a `mode:'fast'` option in `composePlanFromPrompt` using the smallest suitable Vertex AI Gemini model (GCP credits pre-approved) with a constrained JSON schema and a hard output cap, falling back to the full chain only for non-citizen callers, keeping the output plan schema identical so `@three-ws/scene` and the proof hash still work; or (b) make the runner two-phase (submit the compose job, return a pending receipt, complete on the next tick following the pattern other long-running professions use in `work/index.js`, or use an existing per-runner timeout option). Never raise a global timeout without bound.
3. Test-first: `tests/agora-cartographer-runner.test.js` (or the worker's own test location, e.g. `workers/agora-citizens/test/cartographer.test.js`) running the real runner against a locally started `api/diorama.js` handler, with the LLM transport swapped only at the HTTP boundary by a response recorded in task 1. Assert the deliverable is the canonical plan, the proof is the sha256 of its canonical JSON, the runner is deterministic for a fixed brief, a timeout surfaces a clean typed failure, a compose failure yields an honest failed receipt (no fabricated map), and a plan with an unknown target is rejected.
4. Add `AbortSignal.timeout` to the cartographer call, sized from the measured p95 plus margin and read from config.
5. Re-add `cartographer` to `WORK_RUNNERS`, remove the deferred comment block, update `ACTIVE_PROFESSIONS` consumers (grep for it) and the roster text in `docs/agora.md`.
6. Add a Cartographer task template to the task supply per `docs/agora/tasks/03-task-supply.md` (a themed-map ask, priced inside the existing task price range; read the price table first).
7. Make the result visible: confirm a Cartographer receipt on the citizen passport and receipt panels shows a link to the saved diorama permalink and a thumbnail; if the renderer needs a case for it, add it with a test beside the receipt tests.
8. Confirm the capability bit mapping still holds: `tests/agora-job-board.test.js`, `tests/agora-task-supply.test.js`, `tests/agora-read-model.test.js`, `npx vitest run tests/agora-*.test.js`, `npm run check:vendored` and the worker's whole suite.
9. Exercise one real Cartographer task end to end against the dev API (post a task, let a citizen claim it, receive the deliverable) and record the receipt id.
10. Update status in `00-INDEX.md` and `04-professions.md`, add a `data/changelog.json` entry in community language (citizens now draw maps), run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `grep -n cartographer workers/agora-citizens/work/index.js` shows it inside `WORK_RUNNERS`, and the deferred comment is gone.
- [ ] `npx vitest run tests/agora-cartographer-runner.test.js tests/agora-work-proof.test.js tests/agora-job-board.test.js tests/agora-task-supply.test.js` passes; the worker's whole suite and `npm run check:vendored` pass.
- [ ] The measured p95 of the compose path used by citizens is documented and under the configured job window.
- [ ] One real end-to-end task completed with a receipt that links to a saved diorama (id and link reported).
- [ ] No stub or fake plan appears in any code path (a failed compose throws a typed error).
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| LLM chain credentials missing locally | Take them from the three-ws-api Cloud Run env via the self-unblock playbook; use Vertex AI under the pre-approved GCP credits |
| Compose is too slow for a single request | Build the fast lane or the two-phase runner (task 2); never fake the deliverable, return a canned map, or raise timeouts without bound |
| No funded citizen wallet for the paid task | Use the free-lane or unpaid task template other professions use in dev; any real SOL transfer is covered by Gates |
| A devnet citizen cannot be run | The runner test needs no chain; do not touch the chain-side tests |
| Worker image needs a deploy to take effect | Prepare everything and give the single deploy command; code and tests are done in-session |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Paying citizens from a treasury (any real on-chain transfer) is an on-chain spend: print recipient, amount, token and chain in one table and wait for an explicit yes. Deploying the worker is a production deploy and needs the owner's approval. Batch asks into one message at the end.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/770-plan-agora-cartographer-profession-reactivation.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `770-plan-agora-cartographer-profession-reactivation.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

Code and config the reviewer cited alongside these docs (read them in the repo; they are not copied here): `api/diorama.js`.

### `workers/agora-citizens/work/README.md` (whole file)

~~~~markdown
# Agora professions - the WORK modules

Each profession is an AgenC capability bit (the labor market's type system; see
[`docs/agora.md`](../../../docs/agora.md) and [`../roster.js`](../roster.js)),
backed by a **real** platform skill. A profession module turns a claimed task
into a **real artifact** plus a proof that binds it - the verifiable supply
chain. Nothing here is stubbed: a failed forge/brain/voice call throws and the
citizen reports a real task failure, never a fake success.

## The contract

Every module exports `run<Profession>({ cfg, citizen, job })` and returns the
exact shape [`fetcher.js`](./fetcher.js) established, so the engine submits the
proof on-chain and any Verifier can re-derive it:

```js
{
  result,           // structured result object (worker, profession, summary, …)
  resultText,       // JSON.stringify(result) - for logs
  proofHashHex,     // sha256(deliverable bytes), 64-hex  → agora_activity.proof_hash
  proofHashBytes,   // 32-byte Uint8Array               → completeAgenCTask({ proofHash })
  resultData,       // ≤64-byte CID pointer             → completeAgenCTask({ resultData })
  deliverableUrl,   // public URL of the artifact       → agora_activity.deliverable_url
  bytes, summary,   // size + one-line story
}
```

**The invariant:** `proofHashHex === sha256(the exact bytes served at
deliverableUrl)`. Re-download the deliverable, sha256 it, and you reproduce the
on-chain proof. [`verifier.js`](./verifier.js) does exactly that and emits a
`vouch` the engine projects as a `vouched` activity.

| Bit | Module | Real skill | Deliverable | Proof |
|----:|--------|------------|-------------|-------|
| 0 | `fetcher` | x402 / HTTP service call | response fingerprint | sha256(canonical) |
| 1 | `sculptor` | text → rig-ready GLB (`@three-ws/forge`) | the `.glb` | sha256(GLB bytes) |
| 2 | `scribe` | research / write (`@three-ws/brain`) | the `.md` text | sha256(text) |
| 3 | `cartographer` *(deferred)* | 3D scene / diorama (`@three-ws/scene`) | diorama plan JSON | sha256(canonical) |
| 4 | `crier` | TTS / voice (`@three-ws/voice`) | the audio clip | sha256(audio) |
| 5 | `appraiser` | token / market intel (`@three-ws/intel`) | appraisal JSON | sha256(canonical) |
| 6 | `verifier` | re-derive a proof + attest | the attestation JSON | sha256(canonical) |
| 7 | `namekeeper` | `.sol` resolve (`@three-ws/names`) | resolution JSON | sha256(canonical) |

The **active roster** (`index.js` `WORK_RUNNERS`) is bits **0, 1, 2, 4, 5, 6, 7**.
Bit 3 (`cartographer`) is **deferred, not stubbed**: [`cartographer.js`](./cartographer.js)
is real and calls `/api/diorama` `compose`, but that route decomposes a scene via
an LLM chain whose latency overruns the request budget, so a citizen can't finish
it in time. Re-activation is a one-line re-add to `WORK_RUNNERS` once
`/api/diorama` runs in budget: a longer request timeout on the Cloud Run service,
or a synchronous, in-budget compose lane.

[`index.js`](./index.js) is the registry: `runProfession(profession, ctx)`
dispatches to the right runner. Open by design - add a bit + a real skill + its
runner; never a hardcoded allowlist.

### Namekeeper scope
The Namekeeper ships the **`.sol` resolve** capability (a real SNS read → a real,
hashable record) as its default, always-green path. **ENS** (`.eth`) resolution
runs only for an explicit `.eth` job - the public ENS route takes the name as a
path segment and Vercel treats the trailing `.eth` as a file extension, so a
dotted name misroutes (a real 404, not a default). Minting `*.threews.sol` needs
an authenticated, staked signer and is **deferred** - omitted, not stubbed.

## Storage
Deliverables are stored in R2 via [`api/_lib/r2.js`](../../../api/_lib/r2.js)
(`agora/deliverables/<profession>/<sha256>.<ext>`) and `deliverableUrl` is the
public CDN URL. Without R2 configured: binary deliverables fall back to the
provider's durable URL (forge's hosted GLB - still re-downloadable); text/JSON
deliverables degrade to inline (`deliverableUrl: null`) - the proof still binds
the exact bytes.

## How the engine calls it
[`../engine.js`](../engine.js) WORK step dispatches by the citizen's profession:

```js
const work = await runProfession(profession, { cfg, citizen, job });
// PROVE - profession-agnostic:
await completeTask(client, { taskPda, workerAgentId, proofHash: work.proofHashBytes, resultData: work.resultData });
// PROJECT - proof_hash + deliverable_url onto agora_activity; a Verifier's `work.vouch`
//           becomes a `vouched` activity citing the verified task.
```

The devnet dispatcher currently posts generic work slots (Fetcher-gated); each
profession-diverse citizen holds the Fetcher bit so it claims a slot and fulfils
it with its **specialty** (real sculptor/scribe/… work + a real proof). A fully
profession-tagged dispatcher (per-task `requiredCapabilities` + an embedded
creative brief, and a Verifier target drawn from a recent completed deliverable)
is the natural next step - the runners are already profession-agnostic.

## Verify the supply chain (no devnet needed)

[`../verify-supply-chain.mjs`](../verify-supply-chain.mjs) exercises one
profession end-to-end against the real APIs, then re-derives its proof the way a
Verifier would:

```bash
node workers/agora-citizens/verify-supply-chain.mjs --profession sculptor --prompt "a low-poly fox"
# → prints the GLB deliverableUrl + proofHash, then re-downloads and PASSes
curl -sL "<deliverableUrl>" -o /tmp/d.glb && sha256sum /tmp/d.glb   # == proofHash
```

Proof helpers + the Verifier trust loop are unit-tested in
[`tests/agora-work-proof.test.js`](../../../tests/agora-work-proof.test.js).
~~~~

### `workers/agora-citizens/README.md` (whole file)

~~~~markdown
# agora-citizens - the Agora life engine

The heartbeat that makes [Agora](../../docs/agora.md) *alive*. N real agents,
registered on **AgenC** (the Solana coordination protocol by Tetsuo Corp,
devnet), run the **daily loop** on their own jittered cadence:

```
IDLE → SEEK (read the board) → CLAIM (on-chain) → WORK (the citizen's real craft)
     → PROVE (proofHash + completeTask) → EARN → SPEND (post a bounty / hire) → IDLE
```

Every transition is a **real on-chain action** with a tx signature, projected
into `agora_citizens` / `agora_activity` and the shared `feed:events` ticker.
On-chain is the source of truth; the `agora_*` tables are a projection that never
invents an economic fact. The WORK step dispatches by profession, and **seven**
professions ship with a real backing skill and a real deliverable: `fetcher`,
`sculptor`, `scribe`, `crier`, `appraiser`, `verifier`, `namekeeper`. An eighth
bit (`cartographer`) is deferred rather than stubbed, because the route behind it
overruns the request budget it would have to finish in. The registry, the per-profession
proof contract, and the deferral rationale live in [`work/README.md`](work/README.md).

It mirrors the structure of [`workers/agent-mm`](../agent-mm) and generalizes the
proven [`examples/agenc-task-roundtrip`](../../examples/agenc-task-roundtrip)
(register → claim → complete with a real proof, keypair caching + airdrop
backoff).

## How a citizen works

- **Identity.** Each citizen's canonical AgenC `agentId` is derived via the
  identity bridge (`getCanonicalThreewsAgenCId`) from its identity proofs -   composite > erc8004 > mpl-core > handle. No new namespace is invented. Seeded
  from the **standalone founding workforce** first (Aria, Sol, Echo, Mira, Nyx,
  Koa, Wren), then from **real platform agents** (`agent_identities`) for every
  remaining slot. The crafts are seated first on purpose: a platform-agent citizen
  primaries `fetcher`, so filling from that pool first cut every specialist at the
  default cap and left a Fetcher-only workforce. Both kinds are real on-chain
  agents. Humans are never invented here: this worker only ever writes `kind =
  'agent'` rows. Human citizens join the same Commons by connecting a wallet, and
  the read model counts them separately (`/api/agora/pulse` reports
  `population.agents` and `population.humans`).
- **Signing.** Each citizen (and the work dispatcher) keeps a stable devnet
  keypair under `.cache/` (gitignored - never commit a secret key), funded by the
  faucet with shrinking-chunk backoff.
- **Work supply.** Two independent sources, and they are not the same thing.
  Patron citizens post real escrowed bounties (the product, see "Task 03" below).
  Underneath that, an internal **dispatcher** keeps a small floor of real on-chain
  Fetcher tasks open so the board is never empty between patron posts and a fresh
  citizen always has something to claim → do → prove → earn. The dispatcher is
  devnet plumbing (native-SOL rewards), **not** a projected citizen and **not**
  the Task-03 bounty product: it projects no `posted_task` row and escrows no
  $THREE. Disable it with `AGORA_DISPATCH_TASKS=0`.
- **Real work.** Each citizen works its own craft and binds the artifact it
  produced into `proofHash = sha256(the exact deliverable bytes)`, re-derivable by
  a Verifier. A Fetcher calls a live service (the AgenC↔x402 bridge by default, or
  a bazaar resource); a Sculptor forges a GLB, a Scribe writes, a Crier speaks. See
  [`work/README.md`](work/README.md) for the full contract.
- **Currency.** Devnet settles in **native SOL** (synthetic plumbing - never
  another real token). On mainnet the reward label is **$THREE**, the only coin
  Agora promotes. Mainnet is out of scope for this worker.

## Run it

```bash
cd workers/agora-citizens

# 1. Plan only - read the board + derive identities, sign nothing, write nothing.
AGORA_DRY_RUN=1 node index.js

# 2. One tick per citizen against devnet (funded keypairs), then exit.
AGORA_ONCE=1 node index.js

# 3. Run the fleet continuously.
node index.js

# 4. World-seed - fill the Commons with real rigged agents (no on-chain, no SOL).
AGORA_SEED_ONLY=1 AGORA_SEED_LIMIT=200 node index.js
```

> The `@three-ws/solana-agent` SDK ships as TypeScript and must be built once
> (`cd ../../solana-agent-sdk && npm run build`) before a real run - the Docker
> image does this automatically. In constrained sandboxes `tsup` can OOM; it
> builds in CI / Cloud Build.

Then inspect the projection:

```bash
curl -s "$AGORA_API_BASE/api/agora/pulse"
curl -s "$AGORA_API_BASE/api/agora/citizens"
curl -s "$AGORA_API_BASE/api/agora/passport?agentId=<hex>"
```

Confirm tx signatures on <https://explorer.solana.com/?cluster=devnet>.

### Funding a devnet fleet (the faucet is per-IP rate limited)

Every citizen is a real AgenC agent that pays its own stake, rent and fees, but
the public devnet faucet caps airdrops per IP: so a fleet of N citizens cannot
each call `requestAirdrop` (the built-in `ensureBalance()` top-up gives up after
its backoff chain with a 429). Land **one** airdrop into a bank wallet, then fan
it out:

```bash
# List the cached signers and their live balances.
node ../../scripts/agora-devnet-fund.mjs --list

# Fan the bank wallet out across the fleet (0.09 SOL each by default).
node ../../scripts/agora-devnet-fund.mjs aria-sculpt sol-scribe echo-crier
```

Fund the bank itself at <https://faucet.solana.com>. Set
`AGORA_TOPUP_THRESHOLD_LAMPORTS` below what you funded so the engine's own
faucet top-up stays out of the way.

#### Self-funding (unattended runs)

The manual fan-out above needs a human at a faucet, which a Cloud Run deploy does
not have. Point `AGORA_DEVNET_FUNDER_SECRET` at a funded devnet wallet (base58 or
a JSON byte array) and the engine tops each signer up itself, with a real
`SystemProgram` transfer, before it registers or works:

```bash
AGORA_DEVNET_FUNDER_SECRET=<base58 devnet secret> \
AGORA_TOPUP_THRESHOLD_LAMPORTS=5000000 \
AGORA_FUNDER_TOPUP_LAMPORTS=15000000 node index.js
```

A signer below `AGORA_TOPUP_THRESHOLD_LAMPORTS` is topped up to
`threshold + AGORA_FUNDER_TOPUP_LAMPORTS`, so fees don't trigger a top-up every
tick. The funder keeps 0.01 SOL back for its own fees, and the faucet stays as
the fallback when no funder is set (or it runs empty). Devnet test SOL only:
never point this at a wallet holding real value.

### Isolated fleets (two engines, one database)

`AGORA_STANDALONE_ONLY=1` runs the standalone founding workforce (Aria, Sol,
Echo, …) and never the platform-agent seed. Without it, every engine pointed at
the same database selects the *same* first-N platform agents, so two concurrent
runs drive one set of keypairs: double claims and contradictory on-chain state.
Use it for a local run, a CI smoke, or a second fleet alongside a live one:

```bash
AGORA_STANDALONE_ONLY=1 AGORA_MAX_CITIZENS=3 AGORA_DISPATCH_TASKS=0 node index.js
```

## Environment

| Var | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes (non-dry) | none | Neon Postgres, the projection sink. Any `POSTGRES_URL` / `NEON_DATABASE_URL` alias resolves too |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | no | - | Shared `feed:events` ticker bus |
| `AGENC_DEVNET_RPC_URL` | no | public devnet | Private RPC (dodges faucet limits). `SOLANA_RPC_URL_DEVNET` and `AGENC_RPC_URL` are read as fallbacks |
| `THREE_WS_BASE_URL` | no | `https://three.ws` | Skill host the profession runners call (forge / brain / voice / intel / names) |
| `THREE_WS_API_KEY` | no | none | Bearer token for the paid flagship skills; without it the runners use the free lanes |
| `AGORA_CLUSTER` | no | `devnet` | `devnet` only for this worker |
| `AGORA_MAX_CITIZENS` | no | `4` | Fleet size cap (faucet-friendly) |
| `AGORA_MIN_CITIZENS` | no | `3` | Floor when seeding finds too few agents |
| `AGORA_STANDALONE_ONLY` | no | `0` | Run the standalone founding workforce only: never the platform-agent seed. Use for an isolated fleet (see below) |
| `AGORA_TICK_MS` / `AGORA_TICK_JITTER_MS` | no | `45000` / `20000` | Per-citizen loop cadence ± jitter |
| `AGORA_DISPATCH_TASKS` | no | `1` (devnet) | Internal devnet work supply on/off |
| `AGORA_MIN_OPEN_TASKS` / `AGORA_MAX_OPEN_TASKS` | no | `3` / `8` | Dispatcher open-task pool bounds |
| `AGORA_TASK_REWARD_LAMPORTS` | no | `1000000` | Per-task devnet reward (0.001 SOL) |
| `AGORA_TASK_DEADLINE_SECS` | no | `3600` | Deadline stamped on a dispatched task (floor 300) |
| `AGORA_STAKE_LAMPORTS` | no | `1000000` | On-chain stake per agent (AgenC devnet `minAgentStake`) |
| `AGORA_AIRDROP_LAMPORTS` | no | `1000000000` | Faucet request size when a signer needs topping up (1 SOL) |
| `AGORA_DEVNET_FUNDER_SECRET` | no | (none) | Funded devnet wallet (base58 / JSON array) the engine tops signers up from when the faucet is dry |
| `AGORA_TOPUP_THRESHOLD_LAMPORTS` | no | `200000000` | Balance below which a signer gets funded (0.2 SOL) |
| `AGORA_FUNDER_TOPUP_LAMPORTS` | no | `100000000` | Headroom above the threshold a funder top-up lands at (0.1 SOL) |
| `AGORA_API_BASE` | no | `https://three.ws` | Board + bridge read host |
| `AGORA_DRY_RUN` | no | `0` | Plan only - no signing, no writes |
| `AGORA_ONCE` | no | `0` | One tick per citizen, then exit |
| `AGORA_SEED_ONLY` | no | `0` | World-seed mode: project rigged agents, then exit |
| `AGORA_SEED_LIMIT` | no | `120` | How many rigged agents to project (DB holds all; the 3D world renders the 200 most recent) |
| `AGORA_SEED_RESET` | no | `1` | Clear the prior *unregistered* world-seed first (never touches on-chain citizens/humans) |
| `AGORA_MAX_RETRIES` / `AGORA_RETRY_BASE_MS` | no | `4` / `1500` | Bounded exponential backoff on every on-chain call |
| `AGORA_HEARTBEAT_MS` | no | `30000` | Liveness heartbeat into `bot_heartbeat`; `0` disables |
| `PORT` | no | - | Bind a health endpoint (Cloud Run) |

## Populate the Commons (world-seed)

`AGORA_SEED_ONLY=1` fills the world **immediately, with no on-chain registration
and no SOL**. It projects the platform's own 3D agents that carry a **rigged
humanoid GLB avatar** into `agora_citizens`, one citizen per distinct avatar
(de-duped so the square isn't full of clones), each with:

- its **real avatar** (`avatar_url` = the avatar id the client resolves to the GLB
  via `/api/avatars/:id`),
- a **canonical AgenC id** derived offline via the identity bridge (no signature),
- a **profession** mapped from the agent's real signals (category / tags / name),
  with signal-less agents spread deterministically across all professions so the
  labour market reads balanced.

Seeded citizens have **no `agenc_agent_pda`** (the API/world render them as
*pending registration*) and **no activity row** - they simply exist and idle. Every
economic fact still traces to a real on-chain action: when the funded life-engine
runs (`node index.js`), it registers each on AgenC (backfilling the PDA) and they
start claiming → working → earning. This decouples *being alive in the world* from
*spending SOL to transact*, so the Commons is never an empty void while devnet
funding is arranged.

```bash
# Fill the world with 200 rigged citizens (idempotent; re-run to refresh).
AGORA_SEED_ONLY=1 AGORA_SEED_LIMIT=200 node index.js
# Then the live world shows them:
curl -s "$AGORA_API_BASE/api/agora/pulse"      # population + profession mix
curl -s "$AGORA_API_BASE/api/agora/citizens"   # the renderable roster
```

## Scale the fleet

Raise `AGORA_MAX_CITIZENS` (each is a real AgenC agent needing devnet SOL - a
private RPC with a generous faucet, or pre-funded `.cache/` keypairs, is strongly
recommended past a handful). Pace it with `AGORA_TICK_MS` so the fleet doesn't
stampede the faucet/RPC.

## Resilience

- Every on-chain call is wrapped in bounded exponential backoff; a single
  citizen's failure (bad RPC, lost claim race, faucet starvation) is caught and
  never halts the others.
- Re-running reconciles from on-chain state and **does not double-project**: the
  `agora_activity_tx_uniq` index makes each on-chain action project at most once.
- Graceful `SIGINT`/`SIGTERM` drain lets an in-flight tick land its writes.

## Task 03 - task supply (bounties + agent-to-agent hiring)

The **SPEND** node makes the board's AgenC lane *real on-chain supply*, not just an
x402 mirror. Three mechanisms, all real escrow, all in [`post.js`](post.js) /
[`demand.js`](demand.js) / [`policy.js`](policy.js) / [`reconcile.js`](reconcile.js):

1. **Patron demand.** A *patron* citizen (the first `AGORA_PATRON_COUNT`) posts
   real `createAgenCTask` bounties on an interval, escrowing the reward (devnet
   SOL; mainnet **$THREE**). Each post projects a `posted_task` activity (citing
   `task_pda` + `tx_signature`) and an `agora-task-posted` feed event, and bumps
   the poster's `tasks_posted`.
2. **Workers claim bounties.** At SEEK, a citizen takes a posted bounty off
   `/api/agora/board` **only if qualified** - capability subset *and* on-chain
   reputation ≥ the task's `minReputation`. It re-reads the task on-chain before
   claiming. Completing it drops the task off the open board (the worker's
   `completed_task` row), releases escrow, and projects the worker's `earned`.
3. **Agent-to-agent hiring.** A citizen working a high-value bounty hires a
   sub-agent (a real sub-task → `hired` activity linking
   `counterparty_citizen_id`). The sub-task is picked up by another citizen; the
   reconcile sweep links the two rows by their shared `task_pda`.

### Reputation ladder (the career ladder)

`minReputation` gates high-value work so newcomers must grind low-value jobs to
climb. Patron tiers rotate across:

| Tier | `minReputation` | Reward (devnet) | Who can take it |
|---|---|---|---|
| **apprentice** | baseline + 0 | `AGORA_TASK_REWARD_LAMPORTS` | anyone, incl. brand-new citizens |
| **journeyman** | baseline + 200 | 2x base | 2 completions |
| **master** | baseline + 500 | 4x base | 5 completions |

**The gates are deltas above AgenC's registration baseline, not absolute
numbers.** AgenC starts every registered agent at reputation **5000**
(`REPUTATION_BASELINE` in [policy.js](policy.js)) and adds **100** per accepted
proof, both measured against devnet. Written as absolutes, a ladder of 0/5/20
gates nothing: a citizen that has never worked a day already clears the top rung
by two orders of magnitude. Override the baseline with
`AGORA_REPUTATION_BASELINE` if the protocol's starting value ever changes.

So a freshly registered citizen (rep 5000) *skips* a master bounty, logged as
`skipping bounty: not qualified` with `reason: "below_min_reputation"`; after 5
completed tasks (rep 5500) it takes the same bounty. The skip log always names
which gate rejected it, because `missing_capability` (the common case, a citizen
without the required profession bit) and `below_min_reputation` are completely
different diagnoses.

## Task 09 - Arena (Competitive) + Guilds (Collaborative)

The patron schedule also weaves in occasional **multi-worker** tasks (`maxWorkers > 1`)
so the board regularly lights up with a live race or a filling guild:

- **Arena (`Competitive`).** A juicy purse with a `minReputation` gate. Several
  eligible citizens each `claimTask`, do their REAL profession work, then race to
  `completeTask`. The chain accepts the **first valid proof** and pays it the
  **whole escrow**; every other racer's completion reverts and it **stands down**
  (projected `stood_down`, no reward). Tiebreak = on-chain acceptance order - the
  engine never picks a winner. The winner projects `completed_task` (`outcome:won`)
  + `earned` (full purse) + a whole-task `settled` row that closes the Arena.
- **Guild (`Collaborative`).** An open-entry pool (`minReputation 0`). Up to
  `maxWorkers` citizens each claim, contribute a real sub-result, and complete; the
  program **splits the reward**. Each share is **measured from the escrow** the
  completion drew down as reward (bracketed `readEscrowState`, net of the escrow's rent
  reserve on the completion that closes it, so it is a real on-chain figure and
  never a guess) and projected as `earned`. The reconcile sweep projects `settled`
  when the chain shows the guild finished, or `expired_task` (→ reward returns) if
  it misses its worker target before the deadline.

Both stay on the open board while live - the board's open lane closes an Exclusive
task on its first claim but a multi-worker task only on `settled`/cancel/expire/slash
(`terminalKindsFor`), and surfaces its live worker fill (`current/max`) + type badge.
The live race/guild view reads `GET /api/agora/task?taskPda=…`.

| Var | Default | Purpose |
|---|---|---|
| `AGORA_ENABLE_ARENA` | `1` (devnet) | Post occasional Competitive Arena tasks |
| `AGORA_ENABLE_GUILD` | `1` (devnet) | Post occasional Collaborative Guild tasks |
| `AGORA_ARENA_MAX_WORKERS` | `3` | Racers per Arena (2-8) |
| `AGORA_GUILD_MAX_WORKERS` | `3` | Contributor slots per Guild (2-8) |
| `AGORA_ARENA_REWARD_MULT` / `AGORA_GUILD_REWARD_MULT` | `6` / `6` | Prize pool = base reward × multiplier |
| `AGORA_ARENA_MIN_REP` | `100` | Reputation gate on the Arena purse. A **delta** above the registration baseline, like every rung of the ladder above: `100` is one completed task |

### Reconcile + honest scarcity

- A **reconcile sweep** (`AGORA_RECONCILE_MS`, default 60s) re-reads every open
  posting from the chain and projects `cancelled_task` / `expired_task` /
  `claimed_task` / `completed_task` transitions so the board never shows a stale
  "open" task. Idempotent (one terminal row per `(task_pda, kind)`).
- **An expired posting gets its money back.** A lapsed deadline moves nothing on
  its own: the reward stays locked in the task's escrow until the creator cancels.
  The sweep does that (`cancelAgenCTask`), refunding the creator and projecting a
  `cancelled_task` row citing the refund tx. It runs only for postings by a citizen
  this process can sign for, is driven by chain state rather than by the moment the
  expiry was projected (so a restart cannot strand a pool), and re-reads the task
  before reporting failure so a cancel whose RPC reply was lost is not retried
  forever.
- **No infinite money.** A patron's budget is a bounded allowance over its *real*
  balance; when either is exhausted it stops posting (`patron out of budget`).

### Task-03 environment

| Var | Default | Purpose |
|---|---|---|
| `AGORA_PATRON_COUNT` | `1` | How many citizens act as patrons (also work jobs) |
| `AGORA_PATRON_BUDGET_ATOMIC` | `30×` reward | Bounded posting allowance (honest scarcity) |
| `AGORA_PATRON_POST_INTERVAL_MS` | `90000` | Min interval between a patron's posts |
| `AGORA_ENABLE_HIRING` | `1` (devnet) | Agent-to-agent sub-task hiring on/off |
| `AGORA_SUBTASK_REWARD_ATOMIC` | reward base | Reward a worker offers when hiring |
| `AGORA_RECONCILE_MS` | `60000` | Board↔chain reconcile cadence |
| `AGORA_THREE_TOKEN_ACCOUNT` | - | **mainnet** poster's $THREE token account (required to post $THREE) |
| `AGORA_THREE_MINT` | the $THREE mint | **mainnet** override for the escrowed mint |
| `AGORA_MAINNET_SPEND_CAP_ATOMIC` | `0` | **mainnet** hard cap on cumulative $THREE escrow this process (0 = blocked) |

Mainnet escrow is real money - it's gated behind `AGORA_CLUSTER=mainnet` **and** a
non-zero spend cap **and** a configured token account; devnet (SOL) is the default
and proves the whole flow.

### Verify the supply lane

```bash
# Open bounties our citizens posted (source: agenc), with live-open state:
curl -s "$AGORA_API_BASE/api/agora/board" | jq '.tasks'
# A specific task's on-chain lifecycle:
curl -s "$AGORA_API_BASE/api/agenc/get-task?taskPda=<pda>&cluster=devnet&lifecycle=1" | jq '.task.state, .lifecycle.timeline'
# The hire link (two citizens, one shared task_pda):
#   select kind, citizen_id, counterparty_citizen_id, task_pda from agora_activity where kind='hired';
```

## Where it runs

**Today it runs locally, not on Cloud Run.** There is no `agora-citizens` service
in `us-central1`, and the fleet's devnet signers are the ones cached under
`.cache/` on the machine that runs it. Every mode in "Run it" above is a local
`node index.js`; the dry run needs no database and no SOL, `AGORA_SEED_ONLY=1`
needs the database only, and only the funded loop touches the chain.

The one-command deploy is wired and ready:

```bash
gcloud builds submit --config workers/agora-citizens/cloudbuild.yaml . \
  --region us-central1 --project aerial-vehicle-466722-p5
```

It builds from the repo root, publishes into the shared `workers` Artifact
Registry repo, and deploys a Cloud Run service with `--no-cpu-throttling
--min-instances=1` so the loop keeps ticking between probes, the pinned `three-ws@`
runtime service account, and the `three-ws-vpc` connector so the `feed:events`
ticker reaches the shared Redis proxy on its private address. `DATABASE_URL` and
`UPSTASH_REDIS_REST_TOKEN` come from Secret Manager.

**Before the first deploy, give it a funded devnet wallet.** A Cloud Run instance
has nobody to visit a faucet, and the public faucet answers `429` for long
stretches, so without `AGORA_DEVNET_FUNDER_SECRET` (see "Self-funding" above) the
fleet boots and then cannot pay its own stake. Create the secret and add it to the
deploy step's `--set-secrets`:

```bash
printf '%s' "$AGORA_DEVNET_FUNDER_SECRET" | \
  gcloud secrets create agora-devnet-funder-secret --data-file=- --project aerial-vehicle-466722-p5
gcloud secrets add-iam-policy-binding agora-devnet-funder-secret \
  --member=serviceAccount:three-ws@aerial-vehicle-466722-p5.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor --project aerial-vehicle-466722-p5
```

A deployed fleet must not share signers with a local one (two engines driving one
keypair double-claim and contradict each other on-chain). The image cannot inherit
them: `.cache/` is excluded from the build context, so the service generates its
own and needs its own funding.
~~~~

### `docs/agora/tasks/04-professions.md` (whole file)

~~~~markdown
# Task 04 - Professions (real, profession-specific work)

**Goal:** Expand the workforce from one profession (Fetcher) to the full roster,
each doing **real** work backed by a real platform skill. The headline is
**Sculptor** - a citizen that turns a task into a textured, rigged **GLB** via
`@three-ws/forge`, proves it with `sha256(GLB)`, and records the deliverable URL - the verifiable 3D supply chain. Plus Scribe (LLM), Verifier (re-derives others'
proofs), and the remaining bits as feasible.

**Depends on:** Task 02 (the loop + WORK interface).

## Context to read first
- `docs/agora.md` (§ Professions table).
- `api/agora/[action].js` `PROFESSIONS` array (keep in sync).
- `@three-ws/forge` (`packages/forge/`), `api/forge*.js`, `api/mcp-3d.js` - text →
  GLB. `@three-ws/brain` (brain-mcp / multi-provider router) - LLM. `@three-ws/scene`
  (scene-mcp) - diorama. `@three-ws/voice` - TTS/a2f. `@three-ws/intel` - market.
  `@three-ws/names` - .sol/ENS.
- Task 02 `work/fetcher.js` - the pluggable WORK module shape to copy.
- `api/_lib/r2.js` (`publicUrl`) - where to store a produced GLB so it has a real
  `deliverable_url`.

## Background
The WORK step is pluggable: a profession module takes a claimed task + its
description and returns `{ result, proofHash, deliverableUrl?, resultData }`. The
loop handles claim/complete/projection generically. Each module must produce a
**real artifact** and a proof that binds it: `proofHash = sha256(canonical bytes
of the deliverable)`, so any Verifier (or the UI's Verify button in Task 07) can
re-derive it.

## Build (scope)
Implement one module per profession under `workers/agora-citizens/work/`:
1. **`sculptor.js` (bit 1)** - call forge with the task's prompt → GLB bytes →
   upload to R2 (`publicUrl`) → `deliverableUrl` = the GLB URL,
   `proofHash = sha256(GLB bytes)`, `resultData` = a 64-byte pointer (CID/short
   URL). Handle forge tiers/credits honestly; if the free lane is unavailable, the
   citizen reports the job failed (real failure, not a fake success).
2. **`scribe.js` (bit 2)** - call brain with the task prompt → text →
   `deliverableUrl` (store the text artifact in R2 or return inline), proof =
   `sha256(text)`.
3. **`verifier.js` (bit 6)** - given another citizen's completed task, fetch its
   `deliverable_url`, recompute `sha256`, compare to the on-chain `proofHash`,
   and leave a real attestation (vouch) - projecting a `vouched` activity. This is
   the trust loop: agents checking agents' work.
4. **Remaining bits where a real skill exists** - `cartographer.js` (scene),
   `crier.js` (voice), `appraiser.js` (intel), `namekeeper.js` (names). Implement
   the ones whose backing API is reachable; for any you defer, **do not stub** -    leave the bit out of the active roster and note it, rather than shipping a fake.
5. **Roster update** - give Task 02's roster citizens these professions; keep
   `PROFESSIONS` in `api/agora/[action].js` and `docs/agora.md` in sync with any
   bit you add.

## Out of scope
The UI that renders the GLB/deliverable (Tasks 06/07). Mainnet. Inventing new
capability bits without a backing skill.

## Contracts
- Each module exports `async function work({ task, citizen, client }) →
  { result, proofHash /* 32-byte */, deliverableUrl?, resultData /* ≤64 bytes */ }`.
- Deliverables stored via R2 `publicUrl`; `agora_activity.deliverable_url` set.
- `proofHash` is always `sha256` of the canonical deliverable bytes - consistent
  across producer and Verifier.

## Definition of Done
- [ ] A **Sculptor** citizen completes a real task: paste the GLB `deliverableUrl`
  (loads in a browser / glTF viewer) + the on-chain `proofHash` + the complete tx.
- [ ] Re-downloading that GLB and hashing it reproduces the on-chain `proofHash`
  (show the command + match).
- [ ] A **Verifier** citizen independently re-derives another citizen's proof and
  leaves a real `vouched` attestation (show the row + any on-chain memo/tx).
- [ ] Scribe produces a real text deliverable with a matching proof.
- [ ] Any deferred profession is **omitted**, not stubbed; `PROFESSIONS` +
  `docs/agora.md` stay in sync with what actually ships.
- [ ] No mock outputs anywhere; a failed forge/brain call surfaces as a real task
  failure.

## Verification
```bash
node workers/agora-citizens/index.js     # with a Sculptor in the roster
curl -s "localhost:3000/api/agora/passport?agentId=<sculptor-hex>" | jq '.activity[0]'
# verify the deliverable:
curl -sL "<deliverableUrl>" -o /tmp/d.glb && sha256sum /tmp/d.glb   # == on-chain proofHash
```

## Guardrails
- Forge/brain/voice cost real credits - respect quotas; never loop-spam a paid API.
- Deliverables are world-readable - no secrets in them.
- Push to `threews`; changelog: yes (user-visible - "Agora agents now sculpt 3D
  models, write, and verify each other's work").
~~~~

### `docs/agora/tasks/03-task-supply.md` (whole file)

~~~~markdown
# Task 03 - Task supply (bounties + agent-to-agent hiring)

> **Status: shipped** (`workers/agora-citizens/post.js`, `demand.js`,
> `reconcile.js`). Since this was written the expiry sweep gained a refund: an
> expired posting is **cancelled on-chain** through the new `cancelAgenCTask`
> SDK action (`solana-agent-sdk/src/actions/agenc/tasks.ts`) so the escrowed
> reward returns to its creator instead of stranding, and `reconcileOnce` takes a
> `signerFor(citizenId)` lookup (`index.js`) so it can only sign for citizens this
> process runs; anyone else's posting is left alone. The mainnet switch is
> exactly the contract below (`AGORA_CLUSTER=mainnet` +
> `AGORA_THREE_TOKEN_ACCOUNT`, optional `AGORA_THREE_MINT`), but `config.js`
> refuses a non-dry-run mainnet start: the life engine is devnet-only, and
> mainnet $THREE escrow ships through the human path (`api/agora/act.js`) behind
> `AGORA_MAINNET_ENABLED`. Kept as the build record.

**Goal:** Give the economy *demand*. Citizens (and later humans) post real AgenC
bounties - escrowed in SOL on devnet, **$THREE** on mainnet - with `minReputation`
gates and a profession requirement, and agents **hire each other** (an agent posts
a sub-task mid-job). This makes the board's AgenC lane real on-chain supply, not
just x402 mirrors, and creates the multi-hop value flow (human → agent → sub-agent)
that makes it a true economy.

**Depends on:** Task 02 (citizens exist and run the loop).

## Context to read first
- `docs/agora.md` (§ The on-chain economy, § The daily loop - SPEND node).
- `solana-agent-sdk/src/actions/agenc/tasks.ts` - `createAgenCTask` (reward,
  `requiredCapabilities`, `minReputation`, `maxWorkers`, deadline, `taskType`,
  `rewardMint`), `encodeAgenCDescription`.
- `api/agora/[action].js` - `board` reads `posted_task` projection; you produce it.
- `api/agenc/[action].js` - `get-task`/`list-tasks` for reconciliation.
- Task 02's engine (you extend its SPEND node).

## Background
`createAgenCTask` locks a reward in escrow; `completeAgenCTask` releases it on an
accepted proof. The reward is native SOL unless `rewardMint` (an SPL mint) is set - that's where **$THREE** plugs in on mainnet. The board's AgenC lane
(`api/agora/board`) shows `posted_task` activity rows that have no later
claim/complete - so posting a task = projecting a `posted_task` row with the real
`task_pda` + `tx_signature`.

## Build (scope)
1. **Posting helper** (`workers/agora-citizens/post.js`): given a poster citizen, a
   profession requirement, a reward, and a deadline, call `createAgenCTask`
   (devnet SOL escrow; on mainnet set `rewardMint` to the $THREE mint + the
   poster's $THREE token account). Encode a real human task description. Project a
   `posted_task` activity (cite `task_pda` + `tx_signature`) + an
   `agora-task-posted` feed event; bump `agora_citizens.tasks_posted`.
2. **Demand generator.** A small, *real* policy that decides when a citizen posts:
   e.g. a "patron" citizen with a budget posts Sculptor/Fetcher jobs on an
   interval; any citizen mid-WORK that needs a capability it lacks posts a
   **sub-task** and waits for a worker (true agent-to-agent hiring) - projecting a
   `hired` activity linking `counterparty_citizen_id`. Budgets are real on-chain
   balances; when a citizen is out of funds it stops posting (honest scarcity, not
   an infinite tap).
3. **minReputation ladder.** Make some posted tasks gate on `minReputation > 0` so
   new citizens must grind low-value jobs first - a visible career ladder. Document
   the tiers.
4. **Reconcile + expiry.** A sweep that re-reads posted tasks via the AgenC bridge
   and projects `Cancelled`/`Expired` transitions so the board never shows a stale
   "open" task. Use the `agora_activity` idempotency index.
5. **Board correctness.** Confirm `/api/agora/board` now returns real `tasks[]`
   (source `agenc`) with live-open state, alongside the x402 `services[]`.

## Out of scope
Human-posted bounties from a UI (Task 08 - but keep the posting helper reusable so
08 can call it). Mainnet $THREE rollout (devnet proves the flow; gate mainnet
behind an env). Competitive/Collaborative orchestration visuals (Task 09).

## Contracts
- New: `workers/agora-citizens/post.js`, demand policy in `engine.js`, a reconcile
  sweep (`reconcile.js`).
- Activity kinds produced: `posted_task`, `hired`, and on sweep
  `completed_task`-adjacent state rows as needed (don't fabricate - only project
  what the chain says).
- Feed type: add `agora-task-posted` to `ALLOWED_TYPES`.
- Mainnet switch: `AGORA_CLUSTER=mainnet` + `AGORA_THREE_TOKEN_ACCOUNT` set →
  reward in $THREE; otherwise devnet SOL.

## Definition of Done
- [ ] A citizen posts a real devnet bounty - paste the `createTask` tx + the
  `task_pda`. It appears in `/api/agora/board` `tasks[]` as open.
- [ ] Another citizen claims + completes it (Task 02 loop) → the board drops it →
  escrow releases → poster's `tasks_posted` and worker's `earned` both projected.
- [ ] At least one **agent-to-agent hire** occurs (a `hired` row links two
  citizens) - show the two tx signatures and the linked rows.
- [ ] A `minReputation`-gated task is correctly skipped by a low-rep citizen and
  taken by a qualified one.
- [ ] The reconcile sweep flips a cancelled/expired task out of the open board.
- [ ] No infinite-money: a citizen with no balance stops posting.

## Verification
```bash
node workers/agora-citizens/index.js     # runs loop + demand policy
curl -s localhost:3000/api/agora/board | jq '.tasks'
curl -s "localhost:3000/api/agenc/get-task?taskPda=<pda>&cluster=devnet&lifecycle=1" | jq '.task.state'
```

## Guardrails
- **$THREE only.** Devnet escrow = SOL/synthetic; mainnet escrow = the $THREE mint.
  Never reference any other token.
- Escrow is real money on mainnet - keep mainnet behind an explicit env + a spend
  cap; default to devnet.
- Push to `threews` only; changelog: yes (user-visible - "post bounties + hire agents
  in Agora").
~~~~

### `docs/agora/tasks/00-INDEX.md` (whole file)

~~~~markdown
# Agora - build tasks (read this first)

This directory decomposes **Agora - the living agent + human economy** into
self-contained task prompts. Each `NN-*.md` file is **one chat's worth of work**:
open it in a fresh session, follow it, and ship that slice production-ready.

> **Status (2026-08-06): tasks 01-10 have shipped; task 11 is complete except
> for one box.** `/agora` is live in production with a populated economy, and
> every deliverable in the table below exists in the tree (see the per-task
> Status column). Task 11's performance pass found the Commons dropping to ~1fps
> once its full 200-avatar fleet finishes loading; that is carved out as
> **[task 12](12-fleet-render-performance.md)** rather than counted as passed, so
> nobody reads this index as claiming a perf bar that has not been met. These
> files remain the build record and the pattern for future Agora slices. The
> other remaining roadmap rung is the mainnet $THREE launch, built and gated
> behind `AGORA_MAINNET_ENABLED` (see `api/_lib/agora-policy.js` and the Roadmap
> in [docs/agora.md](../../agora.md)).

> **What Agora is:** a persistent economy where AI agents *and* humans go about
> their daily lives - posting work, doing it, getting paid in **$THREE**, building
> on-chain reputation (via **AgenC**, the Solana coordination protocol by Tetsuo
> Corp), and producing real artifacts - rendered as a world you can watch, built
> as the **life layer over the existing City**. Full vision: **[docs/agora.md](../../agora.md).**

## How to run a task

1. Read **[docs/agora.md](../../agora.md)** (the spec) and **this file** (shared
   context + guardrails) first. Every task assumes both.
2. Open the task file. Read its *Context to read first* list - those are the real
   files you build against; don't re-explore the whole repo.
3. Build to the task's **Definition of Done**. Verify with its **Verification**
   steps. Do not report complete until every DoD box is true (CLAUDE.md rule).
4. Commit when the user says so. **Push to `threews` only** (`git push threews main`).
   Add a `data/changelog.json` entry for any user-visible change.

## Task order & dependencies

```
01 verify foundation ─┬─► 02 life engine ─┬─► 03 task supply ──┐
                      │                    └─► 04 professions ──┤
                      │                                          ▼
                      └────────────────────────► 05 commons ─► 06 economy visuals ─► 07 verify + passport
                                                                                          │
                                              08 humans first-class ◄──────────────────────┤
                                              09 arena + guilds      ◄──────────────────────┤
                                              10 agora MCP           ◄──────────────────────┘
                                                          ▼
                                              11 production hardening + launch
```

| # | Task | Depends on | One chat delivers | Status |
|---|---|---|---|---|
| 01 | [Verify foundation](01-verify-foundation.md) | none | Migration applied, economy API smoke-tested green, SDK build unblocked | shipped |
| 02 | [Life engine](02-life-engine.md) | 01 | `workers/agora-citizens`: N real devnet agents living the daily loop (Fetcher) | shipped |
| 03 | [Task supply](03-task-supply.md) | 02 | Citizens post $THREE bounties + hire each other → board AgenC lane goes real | shipped (`workers/agora-citizens/post.js`) |
| 04 | [Professions](04-professions.md) | 02 | Sculptor (forge), Scribe (brain), Verifier (re-hash), remaining bits | shipped (Cartographer deferred, see `work/index.js`) |
| 05 | [Commons scaffold](05-commons-scaffold.md) | 01 (02 ideal) | `/agora` page on the City: render citizens, passport panel, empty states | shipped |
| 06 | [Economy visuals](06-economy-visuals.md) | 05 | Job board, claim-walk, busy ring, deliverable plinth, $THREE flow, ticker | shipped (`src/agora/economy-layer.js`) |
| 07 | [Verify + passport UI](07-verify-and-passport.md) | 06 | Re-hash-to-verify, living passport, cross-chain identity handshake | shipped (`src/agora/trust-surface.js`) |
| 08 | [Humans first-class](08-humans-first-class.md) | 05 | Wallet-auth: post/hire/complete/verify/vouch from the UI; your avatar joins | shipped (`api/agora/act.js`) |
| 09 | [Arena + guilds](09-arena-and-guilds.md) | 03, 06 | Competitive race + Collaborative guild visualizations | shipped + verified on devnet 2026-08-06 (`src/agora/arena.js`, `guild.js`) |
| 10 | [Agora MCP](10-agora-mcp.md) | 03 | `packages/agora-mcp`: external agents join the workforce over MCP | shipped |
| 11 | [Production hardening](11-production-hardening.md) | all | Tests, a11y, perf, all states, changelog, deploy verify, push threews | shipped, except the fleet-render perf box (see 12) |
| 12 | [Fleet render performance](12-fleet-render-performance.md) | 11 | Restore 60fps with the full avatar fleet on `/agora` | open |

Tasks on different branches of the DAG can run in parallel chats (e.g. 03 ∥ 04;
08 ∥ 09 ∥ 10). Respect the dependency column.

## Shared context - the real surfaces you build on

Agora assembles surfaces that already exist. **Do not rebuild them.** Paths are
from repo root `/workspaces/three.ws`.

### On-chain AgenC (the economy's truth)
- **Write SDK** - `solana-agent-sdk/src/actions/agenc/` → imported as
  `@three-ws/solana-agent`. Functions: `createAgenCClient`, `registerAgenCAgent`,
  `createAgenCTask`, `claimAgenCTask`, `completeAgenCTask`, `cancelAgenCTask`
  (refunds an expired posting's escrow to its creator), `getAgenCAgent`,
  `getAgenCTask`, `getAgenCTaskLifecycle`, `listAgenCTasksByCreator`, identity bridge
  (`getCanonicalThreewsAgenCId`, `buildThreewsMetadataUri`, `toAgenCAgentId`).
- **Read bridge (HTTP, free, no key)** - `api/agenc/[action].js`:
  `/api/agenc/list-tasks`, `/get-task` (`&lifecycle=1`), `/get-agent`,
  `/x402-services`, `/link`.
- **Proven end-to-end reference** - `examples/agenc-task-roundtrip/run.mjs`
  (devnet register→post→claim→complete with a real proof; keypair caching +
  airdrop backoff). **Model the life engine on this.**
- **Devnet program** `6UcJzbTEemBz3aY5wK5qKHGMD7bdRsmR4smND29gB2ab`.
  Task states: Open/Claimed/Completed/Cancelled/Disputed/Expired. Agent status:
  Inactive/Active/Busy/Suspended. Task types: Exclusive/Collaborative/Competitive.

### Agora's own layer (already built - Phase 1)
- **Spec** - `docs/agora.md`.
- **Data model** - `api/_lib/migrations/20260629020000_agora_world.sql`
  (`agora_citizens`, `agora_activity`). Read it for exact columns. It's a
  **projection** over the chain: every `agora_activity` row must cite a real
  `tx_signature` / `task_pda` / feed id.
- **Economy read API**: `api/agora/[action].js`: `citizens`, `board`, `pulse`,
  `passport`, and `task` (the live Arena/Guild roster + lifecycle,
  `GET /api/agora/task?taskPda=`). The 3D Commons and dashboards consume these.
- **Profession ↔ capability-bit map** lives in both `docs/agora.md` and the
  `PROFESSIONS` array in `api/agora/[action].js`. Keep them in sync. Open
  registry - add a bit + a real backing skill, never a hardcoded allowlist.

### Platform plumbing (match these patterns exactly)
- **DB** - `api/_lib/db.js` exports `sql` (tagged template; fragments compose -   see the file header). Migrations are timestamped SQL in
  `api/_lib/migrations/`; apply with `npm run db:migrate`, inspect with
  `npm run db:status` (`npm run db:check` is the deploy gate, `npm run db:restamp`
  re-records a comment-only edit to an applied file). An unconfigured or
  unreachable database answers a retryable 503, not a 500. **Workers run outside
  `api/`**: give them their own
  `neon(process.env.DATABASE_URL)` client (don't import `api/_lib/db.js` across
  the boundary).
- **Live feed**: `api/_lib/feed.js` exports `publishFeedEvent({ type, actor, … })`
  and `readFeedEvents`. `ALLOWED_TYPES` is a closed set; the thirteen `agora-*`
  event types (`agora-registered`, `agora-task-posted`, `agora-hired`,
  `agora-task-claimed`, `agora-task-completed`, `agora-earned`,
  `agora-arena-entered`, `agora-arena-won`, `agora-arena-lost`,
  `agora-guild-joined`, `agora-guild-contributed`, `agora-vouched`,
  `agora-flagged`) are already registered there. Any NEW event type must be
  added to that set before publishing it.
- **HTTP handlers** - `api/_lib/http.js`: `wrap`, `json`, `error`, `method`,
  `cors`, `readJson`, `rateLimited`; rate-limit via `api/_lib/rate-limit.js`
  (`limits.publicIp(clientIp(req))`, 240/min per IP). A denied limit answers with
  `rateLimited(res, rl)` so the 429 carries `retry-after` and the limiter's
  reason. Copy the shape of `api/agora/[action].js`.
- **The City (3D substrate)** - `pages/city.html` + `src/city/city-world.js`
  (scene/renderer/loop), `city-map.js`, `city-player.js`, `city-camera.js`,
  `city.css`. **Avatars**: `src/glb-canonicalize.js`, `src/animation-manager.js`,
  `src/animation-retarget.js`, `src/agent-avatar.js`; clips in
  `public/animations/`.
- **3D generation** - `@three-ws/forge` (`packages/forge/`), backing
  `api/forge*.js` + `api/mcp-3d.js`. Text/image → rig-ready GLB.
- **x402 payments** - `api/_lib/x402/bazaar-client.js` (`Bazaar`), `api/x402/*`,
  `api/_lib/x402-spec.js`. Micro-payments in USDC, and in $THREE on the Solana
  rail when `X402_ACCEPT_THREE_SOLANA` is on (a resource quoting both renders a
  token chooser in checkout; agent wallets stay USDC-only), plus the bazaar
  service directory.
- **Pages/routing** - register new pages in `data/pages.json`; HTML in `pages/`,
  JS in `src/`, CSS co-located or in `public/`. Vite multi-entry
  (`vite.config.js`), dev server `npm run dev` (port 3000).

## Global guardrails (every task)

These come from **[CLAUDE.md](../../../CLAUDE.md)** - the repo operating rules.
The ones that bite hardest in Agora:

1. **The only coin is `$THREE`** (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`).
   The economy is denominated in $THREE. Devnet plumbing uses native SOL or a
   clearly-synthetic placeholder mint (e.g. `THREEsynthetic1111…`) - **never**
   another real token, anywhere (code, tests, fixtures, copy, commits).
2. **No mocks, no fake data, no stubs, no `setTimeout` fake progress, no TODOs.**
   Real AgenC, real forge output, real x402 calls, real signed-in humans. An
   empty economy renders an honest empty state; it never fabricates citizens or
   trades.
3. **On-chain is truth; `agora_*` is projection.** Never let the world layer
   invent an economic fact. Every activity row cites a real action. Re-read the
   chain on conflict.
4. **Every state is designed** - loading (skeletons), empty (with a next action),
   error (actionable), populated, overflow (0/1/1000 citizens, very long names,
   mid-operation network failure). Accessibility + keyboard nav + focus states
   are not optional.
5. **Verify before claiming done.** For UI: `npm run dev`, exercise in a real
   browser, no console errors, real network calls succeeding. For services:
   run them against devnet/real APIs and show output. If you can't verify a step,
   **say so explicitly**.
6. **Concurrent agents share this worktree.** Stage explicit paths (never
   `git add -A`); re-check `git status` + `git diff --staged` before committing.
7. **Push to `threews` only** on push: `git push threews main`. `threeD` is a
   retired, diverged mirror - **never push, pull, or fetch from it**.
8. **Changelog**: user-visible change → append to `data/changelog.json`
   (community-readable), then `npm run build:pages`. Internal-only chores don't.
9. **Watch the bundler trap** - `npx vercel build` overwrites `api/*.js` in place
   with esbuild bundles. If a large `api/` diff shows `__defProp`/`createRequire`
   at `head -1`, recover with `git restore -- api/ public/`.

## Known environment notes

- **`@three-ws/solana-agent` and `@zauthx402/sdk` ship as TS and need building**
  (`dist/`). In some constrained sandboxes `tsup` bus-errors (esbuild OOM); they
  build in CI (Cloud Build). Task 01 covers unblocking this locally. Until built, API
  endpoints that transitively import them can't be imported standalone in Node -   this affects *every* endpoint equally (via `http.js` → `zauth.js`), not just
  Agora's.
- **Devnet faucet is rate-limited.** The roundtrip's airdrop-with-backoff is the
  pattern; for the engine prefer a funded devnet keypair or
  `AGENC_DEVNET_RPC_URL` pointed at a private RPC.
- **Two engines on one DB fight for keypairs.** A second fleet (a local run beside
  the deployed daemon) must set `AGORA_STANDALONE_ONLY=1` so it seats only the
  standalone founding workforce and never drives the same platform-agent signers
  as the first (`workers/agora-citizens/roster.js`, `buildRoster`).

## Task file format

Every task file follows the same shape so they're predictable to run:
**Goal · Depends on · Context to read first · Background · Build (scope) ·
Out of scope · Contracts (exact shapes/paths) · Definition of Done ·
Verification · Guardrails.**
~~~~

