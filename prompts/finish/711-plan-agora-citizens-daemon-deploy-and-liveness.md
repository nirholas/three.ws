# Agora Commons shows a living economy again by deploying the citizens daemon, adding a liveness alarm, and deriving trust grades from the vouch graph

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/711-plan-agora-citizens-daemon-deploy-and-liveness.md`.

**Priority:** P2, new capability with clear value (score 58 of 100 inside the tier). **Area:** agora. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The Agora Commons (`/agora`) is the flagship "agents work, earn and hire each other" demo, and it is currently an empty city: `/api/agora/pulse` reports 280 citizens (270 agents, 10 humans), `active24h: 0`, every citizen `idle`, `tasksCompleted24h: 0`, and `/api/agora/board` has `openTaskCount: 0`. The only thing driving the life loop is `workers/agora-citizens`, a Cloud Run daemon that is code-complete (Phase 2 shipped) but is not deployed: no `agora-citizens` service exists in the project. Nothing alarms when the economy goes quiet. The last roadmap rung in `docs/agora.md` (trust grades fed by the attestation/vouch graph) is also unbuilt: `agora_vouches` rows are written by `api/agora/act.js` `actVouch`, but nothing reads them into a grade.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `curl -s https://three.ws/api/agora/pulse`: `economy.tasksCompleted24h: 0`, `payouts24h: 0`, `population.active24h: 0`, `byStatus: { idle: 280 }`; top earners (Sol, Aria, Echo) have 9 completed tasks each from earlier runs, so the loop worked once and stopped.
- `gcloud run services list` shows no `agora-citizens` service and `gcloud run jobs list` shows no matching job.
- `workers/agora-citizens/` is complete: `index.js`, `engine.js`, `demand.js`, `agenc.js`, `reconcile.js`, `Dockerfile`, `cloudbuild.yaml` (substitutions `_MIN_INSTANCES=1`, `_MAX_INSTANCES=1`, `_MAX_CITIZENS=4`, SA pinned to `three-ws-build@`), and a README with the env table (`AGORA_CLUSTER=devnet`, `AGORA_DEVNET_FUNDER_SECRET` for self top-up, `AGORA_DISPATCH_TASKS`, tick cadence 45s plus jitter).
- The worker is devnet only for the AgenC economy (the README says devnet only), so running it spends devnet SOL, not real funds. Mainnet $THREE escrow stays behind `AGORA_MAINNET_ENABLED` and is out of scope.
- No `trust grade` symbol exists in `api/agora/`, `api/_lib/agora-*.js` or `src/agora/`; `src/agora/passport-panel.js` shows a passport without a grade.
- Read model tests exist (`tests/agora-read-model.test.js`, `tests/agora-migrations.test.js`, `tests/agora-mcp-tools.test.js`).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
curl -s https://three.ws/api/agora/pulse | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['population']['active24h'], d['economy'])"
curl -s https://three.ws/api/agora/board | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['openTaskCount'])"
export PATH="$HOME/google-cloud-sdk/bin:$PATH"
gcloud run services list --project aerial-vehicle-466722-p5 --format='value(metadata.name)' | grep -i agora
gcloud secrets list --project aerial-vehicle-466722-p5 --format='value(name)' | grep -iE 'agora|devnet'
grep -rn -iE 'trust.?grade' api src pages | head
npm run db:status
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Local proof first: with `DATABASE_URL` from the service env (`node scripts/read-service-env.mjs '^DATABASE_URL$' --raw`, passed only via an env var), run the worker locally in the README's `AGORA_ONCE=1` mode against devnet with a small fleet, confirm one claim to proof to payout cycle lands in `agora_activity`, and record the signatures in the report. Fix whatever breaks (this is the first run in weeks; devnet RPC endpoints, program ids and the funder wallet are the likely failures). If a bug is found, write the failing test in `workers/agora-citizens` first.
2. Provision the runtime: create Secret Manager secrets for `DATABASE_URL` reference, the devnet funder (`AGORA_DEVNET_FUNDER_SECRET`, a fresh devnet-only keypair funded from the devnet faucet or `solana airdrop`; never a mainnet key) and the worker keypair store if it uses one; bind to the `three-ws@` runtime service account.
3. Deploy: `gcloud builds submit --config workers/agora-citizens/cloudbuild.yaml --region us-central1 --project aerial-vehicle-466722-p5 --substitutions=SHORT_SHA=manual$(date +%s) .` (the deploy gate applies unless the instruction is the approval; prepare the command and secrets either way). Keep `max-instances` 1 (the engine owns citizen wallets and must not double-run). Use `--update-env-vars`, never `--set-env-vars`.
4. Verify live: within 10 minutes `/api/agora/pulse` shows `active24h` greater than 0 and the activity ticker has new `earned` rows; `/api/agora/board` shows a non-zero open task pool (dispatcher keeps 3 to 8 open); load `/agora` in a real browser and confirm citizens move, the board lists open tasks, no console errors, and a passport opens. Watch the service logs for 30 minutes for crash loops, RPC 429s and wallet top-up churn.
5. Liveness alarm: add an `agora_economy` entry to `api/_lib/ops/subsystem-health.js` that reads the newest `agora_activity` row age: `ok` under 30 minutes, `degraded` 30 minutes to 6 hours, `down` beyond (the daemon should tick every ~45s). Extend `tests/subsystem-health.test.js` with the thresholds. This must not fail the whole healthz for a devnet toy: mark it non-critical in the aggregate the same way other advisory subsystems are.
6. Trust grades from the vouch graph: add `api/_lib/agora-trust.js` computing a grade (A to E, plus the numeric score and the inputs) per citizen from: reputation, verified completions ratio, distinct-vouchers count (weighted so one wallet cannot farm vouches: cap per voucher, discount vouchers who are the citizen's own hirers, ignore self and same-owner vouches), and slash history. Pure function with `tests/agora-trust.test.js` covering the farm-resistance cases (sybil ring of 10 mutual vouches must not exceed a single honest vouch's weight). Surface the grade and breakdown in `/api/agora/passport` and render it in `src/agora/passport-panel.js` with a designed empty state ("no vouches yet, complete a verified task to earn a grade") and keyboard-focusable explanation tooltip. Update `docs/agora.md` roadmap: tick the attestation/vouch item for the grade half and leave the mainnet economy line as the remaining rung.
7. Docs and changelog: update `workers/agora-citizens/README.md` with the deployed service name and the runbook, `docs/agora.md` status, add a `data/changelog.json` entry, run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `curl -s https://three.ws/api/agora/pulse` shows `population.active24h > 0` and `economy.tasksCompleted24h > 0` after 30 minutes of the daemon running.
- [ ] `gcloud run services describe agora-citizens --region us-central1 --project aerial-vehicle-466722-p5` answers with min and max instances 1 and zero error-level log lines in the last 30 minutes.
- [ ] `/api/healthz` lists `agora_economy` with status `ok`.
- [ ] `node --test tests/agora-trust.test.js tests/subsystem-health.test.js` pass; a 10-wallet mutual vouch ring does not out-grade an honest history in the test.
- [ ] `/agora` in a real browser: citizens animate, passport shows a trust grade, no console errors.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Devnet faucet rate limits | Use the worker's own `AGORA_DEVNET_FUNDER_SECRET` top-up path and a paid devnet RPC lane from the existing env; space airdrops; devnet SOL has no monetary cost. |
| The engine tries a mainnet action | It must not: `AGORA_CLUSTER=devnet` and `AGORA_MAINNET_ENABLED` unset. If any path attempts mainnet, fix it and add a test. |
| Two daemons double-running | Keep `max-instances` 1 and assert the engine's single-owner lock in logs. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

The worker uses devnet only. If any task would enable mainnet escrow (`AGORA_MAINNET_ENABLED`), stop: that is an irreversible on-chain spend and needs the explicit confirmation table. All such asks are batched into one message at the end.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/711-plan-agora-citizens-daemon-deploy-and-liveness.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `711-plan-agora-citizens-daemon-deploy-and-liveness.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

Code and config the reviewer cited alongside these docs (read them in the repo; they are not copied here): `workers/agora-citizens/cloudbuild.yaml`.

### `docs/agora.md` (section "Roadmap")

~~~~markdown
## Roadmap

**Phase 1 - Foundation** *(shipped)*
- [x] Canonical spec (this doc)
- [x] `agora_citizens` + `agora_activity` data model ([api/_lib/migrations](../api/_lib/migrations),
  starting `20260629020000_agora_world.sql`; sanity-tested in
  [tests/agora-migrations.test.js](../tests/agora-migrations.test.js))
- [x] `api/agora/[action].js` - citizens · board · pulse · passport (real reads),
  routed in production (`vercel.json`) and covered by
  [tests/agora-read-model.test.js](../tests/agora-read-model.test.js)

**Phase 2 - Life engine** *(shipped)*
- [x] `workers/agora-citizens` - real devnet AgenC agents running the daily
  loop end-to-end (claim → real work → proof → earn → reputation → hire),
  modeled on [workers/agent-mm](../workers/agent-mm). Seeds citizens from
  `agent_identities`, registers them on AgenC, projects every action. Ships as a
  Cloud Run daemon ([workers/agora-citizens/Dockerfile](../workers/agora-citizens/Dockerfile)).

**Phase 3 - The Commons (3D)** *(shipped)*
- [x] `pages/agora.html` + `src/agora/` on the City substrate: citizens living,
  job board, completions spawning artifacts, $THREE flows, click-through
  passports + the Verify-the-deliverable interaction. Hardened for launch -   Three.js resource disposal + hidden-tab render pause, `prefers-reduced-motion`
  honored across the 3D FX, keyboard focus traps, and honest large-crowd overflow.

**Phase 4 - Humans first-class** *(shipped)*
- [x] Wallet-auth human citizens: post a bounty (escrow $THREE), hire a citizen,
  complete/verify a task, vouch. Watch your bounty get fulfilled live.
  ([api/agora/act.js](../api/agora/act.js), [api/_lib/agora-human.js](../api/_lib/agora-human.js),
  [api/_lib/agora-policy.js](../api/_lib/agora-policy.js), the `src/agora/me-hud.js`
  + `post-form.js` + `actions.js` HUD). Every action is server-side, authenticated
  (a bearer token or API key needs the `wallet:write` spend scope),
  input-validated, idempotent, and spend-capped; mainnet $THREE stays gated behind
  explicit opt-in. The rolling 24h cap is enforced by a pre-chain hold
  (`agora_spend_reservations`): the per-citizen advisory lock is taken in its own
  statement ahead of the sum-and-hold statement, inside one transaction
  ([api/_lib/locked-sql.js](../api/_lib/locked-sql.js)), so the second statement
  reads a fresh snapshot after the lock and two posts fired at once cannot both spend headroom only
  one of them had, and an abandoned hold ages out on its own. A matching **Verify** offers a **one-click vouch** for the
  citizen who produced the deliverable (verify.js → `agora:vouch-prompt` → the HUD's
  real on-chain attestation) - you can only attest to work you actually confirmed.
  Malformed ids never reach the chain: a non-uuid citizen id answers 404 and a
  non-base58 task PDA answers 400 before any wallet work. A Solana RPC outage is a
  retryable `503 rpc_unavailable`, never an opaque 500, and a confirm timeout is
  resolved from the ledger (`recoverTimedOutSignature`, `findCompletionSignature`
  in `agora-human.js`): a claim or completion that did land is projected, and a
  bounty whose confirmation timed out answers `409 escrow_pending` with its
  signature rather than escrowing the reward twice. The public read model answers
  a rate limit with `retry-after` and the limiter's reason, so the Commons' board
  and pulse pollers back off correctly.

**Phase 5 - Depth**
- [x] **Competitive Arena + Collaborative Guilds** - real multi-worker tasks:
  citizens race for the whole escrow (Arena) or split the pool (Guild), both
  rendered as live 3D views bound to on-chain state (see **Arena & Guilds** above).
- [x] Agent-to-agent hiring chains (a worker hires a sub-agent mid-job).
- [x] Agora MCP surface so external agents can join the workforce
  ([packages/agora-mcp](../packages/agora-mcp) - `@three-ws/agora-mcp`: board/pulse/
  citizens/passport/professions reads, `agora_quote_register` and
  `agora_quote_task` previews that sign nothing, and the gated
  register/claim/complete/post writes; tool contract
  covered in [tests/agora-mcp-tools.test.js](../tests/agora-mcp-tools.test.js)).
- [ ] Attestation/vouch graph feeding trust grades; mainnet $THREE economy
  (escrow is built + gated behind `AGORA_MAINNET_ENABLED`; the devnet economy runs
  now, the mainnet launch is the remaining rung).
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

### `docs/agora.md` (section "Invariants")

~~~~markdown
## Invariants

1. **Real or nothing.** No mock citizens, no fake trades, no `setTimeout`
   progress. Every economic fact traces to an on-chain tx or a real platform
   event.
2. **$THREE is the only coin.** The economy is denominated in $THREE; devnet
   plumbing uses SOL or a synthetic placeholder, never another real token.
3. **On-chain is truth; `agora_*` is projection.** Never let the world layer
   disagree with the chain - re-read on conflict.
4. **Professions are open.** New capability bit → real backing skill → documented
   here. Never a hardcoded allowlist.
5. **Every state is designed.** Idle, empty board, failed task, slashed stake,
   1000 citizens - all have a real rendering and a next action.
~~~~

