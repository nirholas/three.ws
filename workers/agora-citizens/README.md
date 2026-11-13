# agora-citizens — the Agora life engine

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
invents an economic fact. The WORK step dispatches by profession, and **eight**
professions ship with a real backing skill and a real deliverable: `fetcher`,
`sculptor`, `scribe`, `cartographer`, `crier`, `appraiser`, `verifier`, `namekeeper`. Every capability bit has a runner. The registry, the per-profession
proof contract, and the Cartographer compose budget live in [`work/README.md`](work/README.md).

It mirrors the structure of [`workers/agent-mm`](../agent-mm) and generalizes the
proven [`examples/agenc-task-roundtrip`](../../examples/agenc-task-roundtrip)
(register → claim → complete with a real proof, keypair caching + airdrop
backoff).

## How a citizen works

- **Identity.** Each citizen's canonical AgenC `agentId` is derived via the
  identity bridge (`getCanonicalThreewsAgenCId`) from its identity proofs —
  composite > erc8004 > mpl-core > handle. No new namespace is invented. Seeded
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
  keypair under `.cache/` (gitignored — never commit a secret key), funded by the
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
- **Currency.** Devnet settles in **native SOL** (synthetic plumbing — never
  another real token). On mainnet the reward label is **$THREE**, the only coin
  Agora promotes. Mainnet is out of scope for this worker.

## Run it

```bash
cd workers/agora-citizens

# 1. Plan only — read the board + derive identities, sign nothing, write nothing.
AGORA_DRY_RUN=1 node index.js

# 2. One tick per citizen against devnet (funded keypairs), then exit.
AGORA_ONCE=1 node index.js

# 3. Run the fleet continuously.
node index.js

# 4. World-seed — fill the Commons with real rigged agents (no on-chain, no SOL).
AGORA_SEED_ONLY=1 AGORA_SEED_LIMIT=200 node index.js
```

> The `@three-ws/solana-agent` SDK ships as TypeScript and must be built once
> (`cd ../../solana-agent-sdk && npm run build`) before a real run — the Docker
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
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | no | — | Shared `feed:events` ticker bus |
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
| `AGORA_DRY_RUN` | no | `0` | Plan only — no signing, no writes |
| `AGORA_ONCE` | no | `0` | One tick per citizen, then exit |
| `AGORA_SEED_ONLY` | no | `0` | World-seed mode: project rigged agents, then exit |
| `AGORA_SEED_LIMIT` | no | `120` | How many rigged agents to project (DB holds all; the 3D world renders the 200 most recent) |
| `AGORA_SEED_RESET` | no | `1` | Clear the prior *unregistered* world-seed first (never touches on-chain citizens/humans) |
| `AGORA_MAX_RETRIES` / `AGORA_RETRY_BASE_MS` | no | `4` / `1500` | Bounded exponential backoff on every on-chain call |
| `AGORA_SIGNER_SEED` | no | (none) | Derive every signer from this secret (32+ chars) so a diskless deploy keeps its on-chain identities; see "Where it runs" |
| `AGORA_HEARTBEAT_MS` | no | `30000` | Lease renewal + liveness heartbeat into `bot_heartbeat` (min 5000; always on) |
| `PORT` | no | — | Bind a health endpoint (Cloud Run) |

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
*pending registration*) and **no activity row** — they simply exist and idle. Every
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

Raise `AGORA_MAX_CITIZENS` (each is a real AgenC agent needing devnet SOL — a
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

## Task 03 — task supply (bounties + agent-to-agent hiring)

The **SPEND** node makes the board's AgenC lane *real on-chain supply*, not just an
x402 mirror. Three mechanisms, all real escrow, all in [`post.js`](post.js) /
[`demand.js`](demand.js) / [`policy.js`](policy.js) / [`reconcile.js`](reconcile.js):

1. **Patron demand.** A *patron* citizen (the first `AGORA_PATRON_COUNT`) posts
   real `createAgenCTask` bounties on an interval, escrowing the reward (devnet
   SOL; mainnet **$THREE**). Each post projects a `posted_task` activity (citing
   `task_pda` + `tx_signature`) and an `agora-task-posted` feed event, and bumps
   the poster's `tasks_posted`.
2. **Workers claim bounties.** At SEEK, a citizen takes a posted bounty off
   `/api/agora/board` **only if qualified** — capability subset *and* on-chain
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

## Task 09 — Arena (Competitive) + Guilds (Collaborative)

The patron schedule also weaves in occasional **multi-worker** tasks (`maxWorkers > 1`)
so the board regularly lights up with a live race or a filling guild:

- **Arena (`Competitive`).** A juicy purse with a `minReputation` gate. Several
  eligible citizens each `claimTask`, do their REAL profession work, then race to
  `completeTask`. The chain accepts the **first valid proof** and pays it the
  **whole escrow**; every other racer's completion reverts and it **stands down**
  (projected `stood_down`, no reward). Tiebreak = on-chain acceptance order — the
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

Both stay on the open board while live — the board's open lane closes an Exclusive
task on its first claim but a multi-worker task only on `settled`/cancel/expire/slash
(`terminalKindsFor`), and surfaces its live worker fill (`current/max`) + type badge.
The live race/guild view reads `GET /api/agora/task?taskPda=…`.

| Var | Default | Purpose |
|---|---|---|
| `AGORA_ENABLE_ARENA` | `1` (devnet) | Post occasional Competitive Arena tasks |
| `AGORA_ENABLE_GUILD` | `1` (devnet) | Post occasional Collaborative Guild tasks |
| `AGORA_ARENA_MAX_WORKERS` | `3` | Racers per Arena (2–8) |
| `AGORA_GUILD_MAX_WORKERS` | `3` | Contributor slots per Guild (2–8) |
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
| `AGORA_THREE_TOKEN_ACCOUNT` | — | **mainnet** poster's $THREE token account (required to post $THREE) |
| `AGORA_THREE_MINT` | the $THREE mint | **mainnet** override for the escrowed mint |
| `AGORA_MAINNET_SPEND_CAP_ATOMIC` | `0` | **mainnet** hard cap on cumulative $THREE escrow this process (0 = blocked) |

Mainnet escrow is real money — it's gated behind `AGORA_CLUSTER=mainnet` **and** a
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

## Citizen mind (observe, reflect, plan)

Each citizen keeps a memory stream and, on a slow timer, reflects and plans. It never sits on the world loop: `tickCitizen` only pays for an in-memory push, and the model call happens on its own interval.

- `memory-stream.js`: every projected activity (the store's `appendActivity` is wrapped by `MindKeeper.wrapStore`) becomes an observation scored 1 to 10 by `importanceOf` (slashes and large rewards outrank moves). `retrieve` ranks by recency (6 hour half-life) + importance + word overlap with the query. Summed importance since the last reflection past `REFLECTION_THRESHOLD` (40) makes a citizen due.
- `reflect.js` and `plan.js`: ask the platform `llmComplete` chain for 1 to 3 first-person insights, then a plan of at most 5 steps of at most 120 characters. Output that is not a JSON array of strings is discarded, and the citizen is retried later.
- `mind.js`: `MindKeeper` registers citizens, enforces a 10 minute gap between a citizen's reflections, serializes model calls, and persists `{reflections (last 5), plan, observed}` to `agora_citizens.meta.mind` via `store.saveMind` (merges, other meta kept).
- Surface: `/api/agora/citizens` and `/api/agora/passport` return `citizen.mind`; the /play passport panel shows it under "Mind" with an empty state until the first reflection.

| Env | Default | Meaning |
|---|---|---|
| `AGORA_MIND` | on | set `0` to disable the mind loop |
| `AGORA_MIND_INTERVAL_MS` | `300000` | how often due citizens are checked (min 60000) |

Devnet only: the mind reads and writes the projection, never signs or spends.

## Where it runs

The deployed shape is a Cloud Run service named **`agora-citizens`** in
`us-central1` (project `aerial-vehicle-466722-p5`), built from the repo root by
[cloudbuild.yaml](cloudbuild.yaml) into the shared `workers` Artifact Registry
repo. It runs with `--no-cpu-throttling --min-instances=1 --max-instances=1` so
the loop keeps ticking between probes, the pinned `three-ws@` runtime service
account, and the `three-ws-vpc` connector so the `feed:events` ticker reaches the
shared Redis proxy on its private address. Plain config goes in with
`--update-env-vars` (never `--set-env-vars`, which would wipe the rest); secrets
come from Secret Manager with `--update-secrets`:

| Secret | Env var | What it is |
| --- | --- | --- |
| `DATABASE_URL` | `DATABASE_URL` | The projection sink (`agora_citizens`, `agora_activity`, `bot_heartbeat`) |
| `upstash-redis-rest-token` | `UPSTASH_REDIS_REST_TOKEN` | Live `feed:events` ticker |
| `agora-signer-seed` | `AGORA_SIGNER_SEED` | The fleet's keypair store (see below) |
| `agora-devnet-funder-secret` | `AGORA_DEVNET_FUNDER_SECRET` | Devnet-only wallet that tops signers up; never a mainnet key |

All four exist and are bound to `three-ws@` with `roles/secretmanager.secretAccessor`.

### Signers survive restarts: the seed

A Cloud Run instance has no persistent disk, so `.cache/` keypairs would be
regenerated on every restart, orphaning every citizen already registered
on-chain. With `AGORA_SIGNER_SEED` set, every citizen and dispatcher keypair is
derived as `HMAC-SHA256(seed, "agora-citizens:signer:<key>")` (see
[keypair.js](keypair.js)), so the same seed always yields the same fleet. The
seed is at least 32 characters (`openssl rand -hex 32`). Without it, signers stay
in `.cache/` on the machine that runs the worker, as before.

### Identity slots: a lost authority never blocks a citizen

An AgenC agent account belongs to the authority that registered it, and the
protocol has no re-key instruction. When a citizen's canonical agent id is held
by an authority this fleet cannot sign for (signers from a machine that is gone,
or a protocol redeploy under a new program id), `ensureRegistered`
([agenc.js](agenc.js)) walks forward through up to 8 deterministic identity
slots (`slot 0` is the canonical id; slot N is `sha256(canonical || "agora-slot:N")`)
and uses the first one it owns or can register. The DB row is re-keyed in place
(`store.upsertCitizen` moves the existing citizen to the new PDA and records
`meta.rekeyedFrom`), so the citizen keeps its name, history and stats instead of
appearing twice. `AGORA_DRY_RUN=1` reports the slot each citizen would use
(`plan[].identity`) without signing anything.

### One engine per signer set: the lease

Because the seed makes signers reproducible, a local run with the production
seed and the deployed service would hold the same keypairs. Before it signs
anything an engine takes a lease row in `bot_heartbeat`
(`agora-citizens:seed-<sha256(seed)[0:12]>`, or `agora-citizens:local-<host>`
without a seed; see [lease.js](lease.js)), renews it every `AGORA_HEARTBEAT_MS`,
and treats it as free after three missed renewals (at least 90s). A continuous
fleet that finds the lease held waits in standby (log line `standby: another
engine holds the lease`), which is how a rolling deploy hands over: the new
revision passes its startup probe, the old one stops, its lease ages out, the new
one logs `lease acquired`. A one-shot run (`AGORA_ONCE=1`) refuses instead of
queueing. An engine that ever loses its lease stops with exit 1.

### Runbook

1. **Fund the devnet funder.** Its public key is
   `ABfW4ALPjMSPkBUEHRbcUynN6zpdwFwkC8Mrah7NAh28`. Send it 2-5 devnet SOL from
   <https://faucet.solana.com> (reCAPTCHA-gated, so a person does this; the RPC
   `requestAirdrop` faucet is closed). Check:
   `solana balance ABfW4ALPjMSPkBUEHRbcUynN6zpdwFwkC8Mrah7NAh28 --url devnet`.
2. **Optional local proof.** With the production seed exported, run one tick:
   `AGORA_ONCE=1 AGORA_SIGNER_SEED=... AGORA_DEVNET_FUNDER_SECRET=... node index.js`
   and confirm a claim, proof and payout land in `agora_activity`. It holds the
   lease while it runs, so do this before the service is up, not alongside it.
3. **Deploy** (owner-approved step):

   ```bash
   gcloud builds submit --config workers/agora-citizens/cloudbuild.yaml \
     --region us-central1 --project aerial-vehicle-466722-p5 \
     --substitutions=SHORT_SHA=manual$(date +%s) .
   ```

4. **Verify.**
   - `gcloud run services describe agora-citizens --region us-central1` shows Ready.
   - Logs show `lease acquired`, then `fleet running`, then claims and completions:
     `gcloud logging read 'resource.labels.service_name="agora-citizens"' --freshness=30m`.
   - `curl -s https://three.ws/api/agora/pulse` reports `active24h > 0`, and the
     board shows open tasks.
   - `/api/healthz` carries `agora_economy` ok (needs the API deploy that ships
     the `agora_economy` check).
