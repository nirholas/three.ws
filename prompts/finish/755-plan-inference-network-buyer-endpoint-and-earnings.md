# Open inference network gets a paid buyer endpoint and a node earnings ledger

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/755-plan-inference-network-buyer-endpoint-and-earnings.md`.

**Priority:** P2, new capability with clear value (score 38 of 100 inside the tier). **Area:** inference. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Anyone can run a node today (`packages/node-operator/`, spec `threews-node/v1`): it registers with an ed25519 identity, polls `GET /api/nodes/jobs`, and returns signed results verified by the coordinator. But nothing on the platform ever enqueues work, so a registered node polls an always-empty queue and earns nothing, and there is no way to list nodes or see what a node did. The operator docs promise "sell compute into the platform's queue" and a "payout address settlement will credit"; neither the buyer side nor the settlement ledger exists. Until it does, the network is a protocol with no demand and no income, so no operator has a reason to join. This order builds the buyer endpoint, the earnings ledger and the public network view. Real payouts to operators stay behind the owner gate.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Coordinator is built: `api/nodes/register.js`, `api/nodes/jobs.js`, `api/nodes/jobs/` (result and failure handlers), `api/_lib/inference-nodes.js` (`registerNode`, `claimJob`, `completeJob`, `failJob`, `verifyResultReceipt`; node registry in Postgres `inference_nodes` mirrored to Redis, jobs in Redis with a 1 hour TTL), `packages/node-operator/` (client, Dockerfiles), `tests/inference-nodes-coordinator.test.js`.
- `enqueueJob()` at `api/_lib/inference-nodes.js` line ~187 has no production caller: `grep -rn "enqueueJob" api src packages --include=*.js` finds only its definition and tests.
- `curl -s https://three.ws/api/nodes` answers `not_found`: there is no public listing of nodes or capabilities.
- The paid LLM lane exists separately: `api/x402/llm-proxy.js` with receipts per `specs/inference-receipts.md` and `api/_lib/inference-settlement.js`. It does not use nodes.
- `specs/inference-nodes.md` says settlement "will gate payment on" a verified receipt and credits the node's payout address; no settlement code or table exists for nodes. `jobs_completed` and `jobs_failed` are a best-effort rollup on the registry row.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
grep -rn "enqueueJob" api src packages --include=*.js | grep -v "tests/"
curl -s https://three.ws/api/nodes | head -c 200
ls api/nodes api/nodes/jobs; ls api/_lib/migrations | grep -i inference
npm test -- tests/inference-nodes-coordinator.test.js
sed -n 1,60p api/x402/llm-proxy.js
```

If a buyer endpoint or earnings table already exists, build only the missing parts.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first. In `tests/inference-nodes-coordinator.test.js` (extend) add failing tests for the buyer path: a request for a capability with no live node answers `503 no_node_available` within the timeout; a request with a live node returns the output once a node posts a verified result; an unverified or failed result never counts as an earning and the buyer receives a typed error; a job that the node never returns expires and is not billed.
2. Buyer endpoint `POST /api/x402/node-inference` (new `api/x402/node-inference.js`, route in `vercel.json` beside the other `/api/x402/*` routes): body `{ capability, model?, input }`, x402-paid in USDC on Solana using the same server-side payment-requirement helpers the sibling x402 handlers use (price per capability from a table in `api/_lib/inference-nodes.js`, documented in the spec). It requires at least one live node (registered and polled within 60 seconds) advertising the capability, calls `enqueueJob`, waits up to 25 seconds for the result (server-side polling of the Redis job record, not a busy loop), verifies the receipt with `verifyResultReceipt`, then settles and returns `{ output, node, receipt, jobId }`. If no node serves the capability, it answers 503 before payment is taken.
3. Earnings ledger: migration `api/_lib/migrations/<ts>_inference_node_earnings.sql` (read `npm run db:status` first, then `npm run db:migrate`): `inference_node_earnings(id, node_public_key, job_id unique, capability, model, amount_atomics, asset, payer_signature, verified_at, payout_status default 'accrued', payout_signature null)`. On verified settle, insert exactly one row per job (idempotent on `job_id`). Add `GET /api/nodes/earnings?node=<pubkey>&ts=&sig=` (signed like `api/nodes/jobs.js`) returning accrued, paid and per-day totals for the operator.
4. Public network view: `GET /api/nodes/list` returning registered nodes with label, capabilities, last seen, jobs completed/failed and verified-earnings counts (never secrets, never IPs), cached 15 seconds. Add the page section to an existing operator/network page if one exists (`ls pages | grep -i node`), else a small `pages/nodes.html` with a skeleton loading state, an empty state ("No nodes online yet. Run one in two minutes", linking `docs/inference-node-operator.md`), an error state with Retry, and hover/focus/active styles. Register the page in `data/pages.json` and the route in `vercel.json`.
5. Payout run in dry-run only: `scripts/inference-node-payouts.mjs --dry-run` aggregates accrued earnings per payout address and prints the exact transfers it would make. The script must refuse to send unless an explicit `--execute` flag and a configured signer are both present, and this order never executes it (see Gates).
6. Extend the end-to-end harness in `packages/node-operator/` (the script that runs the real `api/nodes/*` handlers against an in-process Redis shim, per `docs/inference-node-operator.md`) with the buyer path so it enqueues through the new endpoint logic and fails non-zero unless the receipt verifies.
7. Update `specs/inference-nodes.md` (add the buyer and earnings sections and their error codes), `docs/inference-node-operator.md` (how earnings accrue and how to read them), `api/nodes/README.md` if one exists, `STRUCTURE.md` row, `data/changelog.json`, and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node --test tests/inference-nodes-coordinator.test.js` exits 0 with the new buyer and earnings cases (they failed before steps 2 and 3).
- [ ] With a local node from `packages/node-operator` running, `curl -s -X POST http://localhost:3000/api/x402/node-inference` without payment returns a 402 with payment requirements for a capability the node serves, and 503 `no_node_available` for one it does not.
- [ ] `curl -s https://three.ws/api/nodes/list` (or localhost) returns the registered node with no secret fields.
- [ ] `node scripts/inference-node-payouts.mjs --dry-run` prints accrued totals and sends nothing.
- [ ] The nodes page renders skeleton, empty and populated states in a real browser with no console errors.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Redis locally | The coordinator test lane uses the in-process Redis shim described in `docs/inference-node-operator.md`; for the live check use the Upstash credentials already on Cloud Run |
| Want to test payment without spending | Use the repo's x402 test lane on Solana devnet as in `specs/inference-receipts.md` ("No real funds in proof runs"); never pay mainnet from this order |
| Pricing per capability is unknown | Derive a floor from the cost of the same call on the existing paid lane (`api/x402/llm-proxy.js` price table) and set the node price at that floor; document the number |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

The payout run that moves real USDC to operator addresses is an on-chain spend. This order ships it dry-run only. The owner decides when `--execute` runs and from which signer; the final report states the exact command and the accrued amounts. All such asks are batched into one message at the end.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/755-plan-inference-network-buyer-endpoint-and-earnings.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `755-plan-inference-network-buyer-endpoint-and-earnings.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/inference-node-operator.md` (whole file)

~~~~markdown
# Run an inference node

The three.ws open inference network (Phase 4 of the roadmap) decouples agent
inference from any single provider: agents send jobs to a queue, independently
operated nodes claim them, and every result comes back with a cryptographic
receipt that anyone can verify offline. The **node operator client** in
[`packages/node-operator/`](../packages/node-operator) is how you join the
supply side.

This guide takes a zero-context operator from clone to a verified result.
The wire contract itself is specified in
[specs/inference-nodes.md](../specs/inference-nodes.md).

## What you run

One Node.js process with four parts:

- **Identity.** A Solana ed25519 keypair, generated on first run and written to
  `node-identity.json` (mode `0600`). The public key is your node address, your
  future payout address, and the key every result is verified against. The
  secret key never leaves your machine; the platform only ever sees signatures.
- **Engine.** `Xenova/all-MiniLM-L6-v2` (Apache-2.0) on ONNX Runtime through
  `@huggingface/transformers`. Real local inference, no API keys, no network
  calls once the weights are cached in `./models`. CPU runs the 23 MB q8 graph;
  an NVIDIA GPU runs the 90 MB fp32 graph on CUDA.
- **Loop.** Register, poll, execute, sign, submit, repeat. Bounded concurrency,
  exponential backoff on transient poll failures, and a graceful drain on
  SIGINT/SIGTERM so a restart never abandons half-computed work.
- **Receipts.** Every finished job ships an ed25519 signature binding
  `(jobId, model, prompt, output, startedAt, finishedAt)` to your public key.

## Quickstart

Requires Node.js 20+ and one-time access to huggingface.co for the weights.

```bash
cd packages/node-operator
npm install
npm run self-test
```

The self-test runs the real workload locally and prints the device that
executed it, so you know your hardware works before you register:

```
[node] identity 7Xf3...q9Zk (generated, saved to /path/node-identity.json)
[node] platform https://three.ws · capability text-embedding · model Xenova/all-MiniLM-L6-v2 · device auto
[node] running proof workload self-test (first run downloads the model)...
[node] self-test OK: Xenova/all-MiniLM-L6-v2, 384 dims, ran on cpu (q8) in 1932ms
```

Then register and start taking jobs:

```bash
npm start
```

Ctrl+C drains in-flight jobs and exits cleanly. Back up `node-identity.json`:
losing it means losing the node's identity, its history, and its payout
address.

| Command | What it does |
| --- | --- |
| `npm start` | Register (idempotent) and run the job loop. |
| `npm run register` | Register with the platform and exit. |
| `npm run self-test` | Run the proof workload locally and exit; exit code 1 on failure. |
| `npm start -- --pubkey` | Print the node's base58 public key and exit. |
| `npm test` | Unit suite. |
| `npm run e2e` | Full local proof: register, job, signed result, verification. |

## Docker

Two images, because the difference between them is the base layer rather than
the code. Running the CPU image with `--gpus all` does **not** give you GPU
inference: ONNX Runtime's CUDA execution provider dynamically links the CUDA 12
runtime and cuDNN 9, and those libraries are not in a slim Node image.

CPU:

```bash
cd packages/node-operator
docker build -t three-ws-node:cpu .
docker run -d --name three-ws-node \
  -e NODE_LABEL=atlas-01 \
  -v three-ws-models:/app/models \
  -v three-ws-identity:/app/identity \
  -e IDENTITY_PATH=/app/identity/node-identity.json \
  three-ws-node:cpu
```

NVIDIA GPU (host needs driver >= 525 and the NVIDIA Container Toolkit):

```bash
docker build -f Dockerfile.gpu -t three-ws-node:gpu .
docker run -d --name three-ws-node --gpus all \
  -e NODE_LABEL=atlas-gpu-01 \
  -v three-ws-models:/app/models \
  -v three-ws-identity:/app/identity \
  -e IDENTITY_PATH=/app/identity/node-identity.json \
  three-ws-node:gpu
```

Verify either image before leaving it running:

```bash
docker run --rm three-ws-node:cpu node src/index.js --self-test
docker run --rm --gpus all three-ws-node:gpu node src/index.js --self-test
```

### How device selection behaves

`DEVICE=auto` (the default outside Docker) checks for an attached NVIDIA driver
(`/dev/nvidiactl`, `/dev/nvidia0`, `/proc/driver/nvidia/version`) and uses CUDA
only when one is present. The probe comes before the download so a CPU-only
host never pulls the 90 MB fp32 graph it cannot execute.

Setting `DEVICE` explicitly turns the fallback off. The GPU image ships
`DEVICE=cuda` on purpose: an operator who paid for a GPU should learn in the
first second that it is unreachable, not after a month of CPU-speed earnings.
Without `--gpus all`, that image exits immediately:

```
[node] fatal: could not load Xenova/all-MiniLM-L6-v2 on any of [cuda] ->
  cuda: CUDA failure 35: CUDA driver version is insufficient for CUDA runtime version
```

## Configuration reference

Precedence is **environment variable > `operator.config.json` in the working
directory > default**. Every value is validated at boot, so a misconfigured
node fails with a readable message instead of mid-job. The full table with
config-file keys lives in
[packages/node-operator/README.md](../packages/node-operator/README.md).

| Variable | Default | Notes |
| --- | --- | --- |
| `PLATFORM_URL` | `https://three.ws` | Any coordinator deployment; must be absolute http(s). |
| `CAPABILITY` | `text-embedding` | The capability queue this node drains. |
| `MODEL` | `Xenova/all-MiniLM-L6-v2` | Model id advertised at registration. |
| `DEVICE` | `auto` | `auto`, `cpu`, `cuda`, `webgpu`, `dml`, `coreml`. |
| `DTYPE` | per device | `q8` on CPU, `fp32` on GPU. Override only deliberately. |
| `POLL_INTERVAL_MS` | `5000` | Idle poll cadence; minimum 1000. |
| `MAX_CONCURRENCY` | `1` | Jobs executed in parallel. |
| `JOB_TIMEOUT_MS` | `120000` | Per-job wall-clock ceiling. |
| `IDENTITY_PATH` | `node-identity.json` | Where the keypair is persisted. |
| `OPERATOR_SECRET_KEY` | none | 64-byte ed25519 secret, base58 or base64. Overrides the file. |
| `NODE_LABEL` | none | Human-readable node name. |

## The wire contract

Three calls, JSON over HTTPS, each authenticated by an ed25519 signature over a
short domain-separated string rather than a bearer secret. There is no shared
secret to leak: authority comes from the key, and the key never leaves your
host. Full specification, including error codes, storage lifetimes and the
threat model: [specs/inference-nodes.md](../specs/inference-nodes.md).

```
POST {platform}/api/nodes/register
  body: { publicKey, label?, capabilities: [{capability, model}], registeredAt, signature }
  signature over `threews-node-register:{publicKey}:{registeredAt}`

GET  {platform}/api/nodes/jobs?node={pk}&capability={cap}&ts={ms}&sig={sig}
  sig over `threews-node-poll:{pk}:{ts}`
  -> { job: null } | { job: { id, capability, model, input, deadlineAt } }

POST {platform}/api/nodes/jobs/{jobId}/result
  success: { node, output, startedAt, finishedAt, receipt }
  failure: { node, failed: true, error, startedAt, finishedAt, ts, signature }
  -> { ok: true, verified: true }
```

The receipt payload pre-hashes every variable-length field, so no crafted
prompt can smuggle a separator across a field boundary:

```
sha256hex(jobId).sha256hex(model).sha256hex(prompt).sha256hex(output).startedAt.finishedAt
```

The coordinator does not trust what you send: it recomputes that payload from
the submission plus the prompt and model in its own job record, and rejects
anything that does not match. `verified: true` therefore means the result is
cryptographically bound to your node, which is exactly what settlement will
check before paying you.

## Prove it locally

`npm run e2e` boots the real platform server (`server/index.mjs`, serving the
real `api/nodes/*` handlers) against an in-process Redis shim, enqueues a real
job, and runs the real client through register, poll, inference, signing and
submission. It exits non-zero unless the receipt verifies. No fake coordinator,
no stubbed model, no mocked crypto:

```bash
cd packages/node-operator
npm run e2e
```

```
[e2e] registering node EoZB1MExfAiLhrzpCdRwf9w2rBzAWx6iaraStRvYgKc7
[e2e] [node] job job_e2e_1786739629649 complete (5115ms inference on cpu, verified=true)
[e2e] RESULT VERIFIED

--- e2e transcript ---
model           : Xenova/all-MiniLM-L6-v2
embedding dims  : 384
receipt payload : 0a1ef372...6f1b7d47...6c6d69d4...fa2f675e...1786739633154.1786739638269
verified        : true (recomputed payload + ed25519 against node key)

E2E PASS
```

## The open protocol (OIN), and when to use it instead

The contract above is the coordinator's: the platform holds a queue and your
node claims from it (pull). The
[Open Inference Protocol](../specs/OPEN_INFERENCE_PROTOCOL.md) is the other
direction (push): your node stands on its own with no coordinator in the
middle. You publish a signed capability advertisement at `GET /.well-known/oin`
saying what you run and what it costs, you accept job envelopes at
`POST /oin/jobs`, and every result carries an ed25519 signature over a digest
of the exact job plus a hash of the exact bytes you produced. Nothing about it
is three.ws-specific, which is the point: a requester that has never heard of
this platform can verify your work.

Use the coordinator contract to sell compute into the platform's queue; use OIN
to be reachable by anyone. They share a key type and coexist in one process, so
a node can do both.

The platform's mesh stylization worker is the reference OIN node
([`workers/stylize/oin.py`](../workers/stylize/oin.py), enabled by
`OIN_ENABLED=true`), and the conformance runner proves any node speaks the
protocol before it takes a paying job:

```bash
node scripts/oin-conformance.mjs --node https://your-node.example \
  --api-key "$NODE_API_KEY" --input https://three.ws/avatars/fox.glb
```

It exits 0 only when the advertisement signature, the job digest, the response
signature, and the artifact hash all check out.

## Security model

- **No shared secret.** Nodes authenticate with signatures over
  domain-separated strings. A compromised coordinator can refuse to hand you
  work; it can never fabricate results in your name, because it never holds
  your key.
- **No cross-call replay.** Register, poll and failure signatures use distinct
  prefixes and carry a timestamp that expires after five minutes.
- **No result theft.** Only the node that claimed a job can close it, and only
  from the running state, so a late or replayed submission cannot overwrite a
  landed result.
- **Verification is offline and pure.** Anyone with the receipt and your public
  key can confirm you computed exactly that output for exactly that job,
  without calling three.ws.

## What this is not (yet)

- The built-in model is the proof workload, not the production catalog. Serving
  larger models means pointing `MODEL` at a bigger ONNX export and running the
  GPU image; the wire contract does not change.
- On-chain settlement (pay-per-job against these receipts) is the adjacent
  roadmap slice. This client already exposes the node address and the signed
  receipts settlement consumes. The payment-side format is specified in
  [specs/inference-receipts.md](../specs/inference-receipts.md).
- Reported `startedAt` / `finishedAt` bind the receipt but are node-reported;
  v1 prices work per job, not per reported wall clock.
~~~~

### `specs/inference-nodes.md` (whole file)

~~~~markdown
# Open inference network: node coordinator contract (`threews-node/v1`)

The wire contract between an independently operated inference node and the
three.ws coordinator (Roadmap phase 4). It covers the three calls a node makes
over its whole lifetime: register, claim a job, return a signed result. Anyone
can implement it; the reference operator client is
[`packages/node-operator`](../packages/node-operator).

- Spec id: `threews-node/v1`
- Status: live. Endpoints [`api/nodes/register.js`](../api/nodes/register.js),
  [`api/nodes/jobs.js`](../api/nodes/jobs.js),
  [`api/nodes/jobs/[id]/result.js`](../api/nodes/jobs/[id]/result.js)
- Server-side implementation: [`api/_lib/inference-nodes.js`](../api/_lib/inference-nodes.js)
- Reference client: [`packages/node-operator/src/platform.js`](../packages/node-operator/src/platform.js),
  [`packages/node-operator/src/signing.js`](../packages/node-operator/src/signing.js)
- Operator guide: [docs/inference-node-operator.md](../docs/inference-node-operator.md)
- Executable proof of the whole contract:
  `node packages/node-operator/scripts/e2e-local.mjs`

## Relationship to the other two inference specs

Three specs touch inference and they are not alternatives; they sit at
different layers.

| Spec | Question it answers | Who talks to whom |
| --- | --- | --- |
| **This one** (`threews-node/v1`) | How does a node join the platform's queue and get paid work? | node -> coordinator (pull) |
| [OPEN_INFERENCE_PROTOCOL.md](OPEN_INFERENCE_PROTOCOL.md) (`oin/v0.1`) | How does any requester call a node directly, with no coordinator? | requester -> node (push) |
| [inference-receipts.md](inference-receipts.md) (`three-inference-receipt/v1`) | How is an x402 payment bound to the job it bought? | payer <-> settlement |

They share the ed25519 primitive and can coexist in one process. A node that
implements this spec sells compute into the platform queue; adding OIN makes
the same box reachable by requesters who have never heard of three.ws.

## Identity

A node's identity is a Solana ed25519 keypair. The base58-encoded public key
is simultaneously:

- the node id (registration is an idempotent upsert on it),
- the routing address the coordinator claims jobs against,
- the payout address settlement will credit,
- the verification key for every result the node returns.

The secret key never leaves the operator host. The coordinator only ever sees
signatures, which means a coordinator compromise cannot forge results for any
node, and a node that loses its key loses its identity (there is no recovery
path by design: an account you can recover without the key is an account
someone else can steal without the key).

## Signature construction

Every authenticated call signs a **domain-separated ASCII string**, never a
JSON object, so there is no canonicalization to get wrong and no field-order
ambiguity. Signatures are ed25519 (RFC 8032) over the UTF-8 bytes of the
string, transported base64.

| Call | Signed string |
| --- | --- |
| register | `threews-node-register:{publicKey}:{registeredAt}` |
| poll | `threews-node-poll:{publicKey}:{ts}` |
| failure report | `threews-node-fail:{publicKey}:{jobId}:{ts}` |
| result receipt | the receipt payload below |

The prefixes are distinct on purpose: a signature harvested from one call is
structurally invalid for any other. Timestamps are integer milliseconds since
the epoch and must be within **5 minutes** of coordinator time (constant
`MAX_CLOCK_SKEW_MS` in each handler), which bounds replay to that window and
makes an operator with a badly wrong clock fail loudly at registration rather
than silently earning nothing.

## 1. Register

```http
POST /api/nodes/register
Content-Type: application/json

{
  "publicKey": "<base58 ed25519 public key>",
  "label": "atlas-01",
  "capabilities": [{ "capability": "text-embedding", "model": "Xenova/all-MiniLM-L6-v2" }],
  "registeredAt": 1786690709863,
  "signature": "<base64 ed25519 over threews-node-register:{publicKey}:{registeredAt}>"
}
```

```json
200 { "ok": true, "node": { "id": "<pubkey>", "publicKey": "<pubkey>", "label": "atlas-01", "capabilities": [ ... ] } }
```

Errors: `400 invalid_public_key`, `400 invalid_capabilities`,
`400 stale_registration`, `401 bad_signature`, `429` rate limited.

Registration is idempotent and re-registering refreshes `last_seen_at` and
replaces the capability list, so a node that changes hardware or models just
registers again. At most 16 capabilities are stored per node.

## 2. Claim a job

```http
GET /api/nodes/jobs?node={publicKey}&capability={capability}&ts={ms}&sig={base64}
```

```json
200 { "job": null }
200 { "job": { "id": "job_...", "capability": "text-embedding", "model": "...", "input": { "text": "..." }, "status": "running", "claimedBy": "<pubkey>", "claimedAt": 1786690713000, "deadlineAt": 1786694309863 } }
```

Errors: `400 missing_params`, `401 stale_signature`, `401 bad_signature`,
`404 node_not_registered`, `429` rate limited.

A claim is a single atomic pop from the capability queue followed by a write
that stamps `claimedBy` and flips `status` to `running`, so two nodes polling
the same capability can never receive the same job. An empty queue is a
`200` with `job: null`, not a `404`: polling is the normal steady state, and
an error status for "nothing to do" would poison every operator's logs and
alerting.

## 3. Return the result

```http
POST /api/nodes/jobs/{jobId}/result

{
  "node": "<base58 pubkey>",
  "output": { "kind": "text-embedding", "model": "...", "dimensions": 384, "embedding": [ ... ] },
  "startedAt": 1786690713952,
  "finishedAt": 1786690720689,
  "receipt": {
    "algorithm": "ed25519",
    "publicKey": "<base58 pubkey>",
    "payload": "<canonical payload string, below>",
    "signature": "<base64>"
  }
}
```

```json
200 { "ok": true, "verified": true }
```

Errors: `400 missing_fields`, `401 bad_receipt`, `403 not_job_owner`,
`404 job_not_found`, `409 job_not_running`.

The coordinator does not trust the submitted receipt: it **recomputes** the
payload from the fields in the request plus the prompt and model held in its
own job record, and rejects any receipt whose payload or signature does not
match. That is what makes `verified: true` meaningful, and it is the check
settlement will gate payment on. Two consequences worth stating plainly:

- A node cannot sign a receipt over a different prompt than the one it was
  assigned, because the prompt in the payload comes from the coordinator's
  record, not from the submission.
- Only the node that claimed the job can close it (`403` otherwise), and only
  from the `running` state (`409` otherwise), so a replayed or late submission
  can never overwrite a result that already landed.

### Receipt payload

```
sha256hex(jobId) "." sha256hex(model) "." sha256hex(prompt) "." sha256hex(outputJSON) "." startedAt "." finishedAt
```

Every variable-length field is pre-hashed, so the `.` separators cannot be
smuggled across field boundaries by a crafted prompt. Digests are lowercase
hex SHA-256 over UTF-8 bytes, computed with WebCrypto on both sides so a
browser verifier reproduces them exactly. `outputJSON` is `JSON.stringify` of
the output object (or the string itself, when the output is a string), and
`startedAt` / `finishedAt` are decimal integer milliseconds.

Verification needs nothing but the payload, the signature, and the node's
public key. It is pure and offline:
[`verifyResult`](../packages/node-operator/src/signing.js) recomputes the
payload from the claimed facts before checking the signature (the check that
catches a node signing an output it did not submit);
[`verifyResultReceipt`](../api/_lib/inference-nodes.js) is the identical
server-side function.

### Failure reports

A node that cannot finish a job says so instead of going silent, which lets
the coordinator requeue or refund immediately rather than waiting out the
deadline:

```http
POST /api/nodes/jobs/{jobId}/result

{
  "node": "<pubkey>",
  "failed": true,
  "error": "job job_x exceeded 120000ms",
  "startedAt": 1786690713952,
  "finishedAt": 1786690833952,
  "ts": 1786690833960,
  "signature": "<base64 ed25519 over threews-node-fail:{publicKey}:{jobId}:{ts}>"
}
```

```json
200 { "ok": true, "verified": false }
```

`verified: false` is correct and not an error: a failure report carries no
result to verify. The error string is truncated to 500 characters.

## Storage and lifetimes

| Record | Store | Lifetime |
| --- | --- | --- |
| Node registry | Postgres `inference_nodes`, mirrored to Redis `inode:{pubkey}` when the database is unreachable | 30 days per registration, refreshed on every register |
| Job record | Redis `ijob:{jobId}` | 1 hour (`JOB_TTL_S`) |
| Capability queue | Redis list `iqueue:{capability}` | until claimed or the job expires |

Jobs are deliberately Redis-only and ephemeral (one-shot, TTL-bounded), which
matches the platform's agent-screen task queue. The node registry is the part
that must survive a cache flush, so it is durable in Postgres with a Redis
fallback that keeps a bare local stack (no Postgres) usable for development.
`jobs_completed` / `jobs_failed` on the registry row are a best-effort rollup
for operator-facing stats; the Redis job record is the authoritative outcome.

## Rate limits

Per IP, enforced by `api/_lib/rate-limit.js`: `nodeRegisterIp` on the register
endpoint, `nodeJobIp` on both the poll and result endpoints. A limited call
returns `429` with the standard rate-limit headers. A node polling on the
default 5 s cadence is far under the ceiling; a node hammering the queue is
not, which is the intent.

## Threat model

| Attack | Why it fails |
| --- | --- |
| Register someone else's public key | Registration requires a signature under that key. |
| Drain another node's queue | The poll signature is over the node's own key; a claim stamps that key. |
| Replay a captured poll signature | The signed timestamp expires after 5 minutes. |
| Reuse a register signature as a poll signature | Different domain prefixes; the string does not verify. |
| Submit a result for a job you did not claim | `403 not_job_owner`. |
| Overwrite a completed job | `409 job_not_running`. |
| Sign one output and submit another | The coordinator recomputes the payload from the submission and its own record. |
| Claim a longer runtime than the work took | Out of scope for v1: `startedAt` / `finishedAt` are node-reported and only bind the receipt. Settlement prices work by job, not by reported wall clock. |
| A malicious coordinator forging node results | Impossible: the coordinator never holds a node secret key. It can refuse work, not fabricate it. |

## Conformance

A node implements `threews-node/v1` when, against a live coordinator:

1. It registers with a signature that verifies under its published key.
2. It claims a job with a signed, in-window timestamp and executes it.
3. It returns a receipt whose payload the coordinator recomputes bit for bit
   and whose signature verifies, yielding `verified: true`.
4. It reports failures with a signed failure report rather than going silent.

`node packages/node-operator/scripts/e2e-local.mjs` runs exactly that sequence
against the real handlers in `api/nodes/*` (booted from `server/index.mjs`)
with real model inference and real ed25519 keys, and exits non-zero unless the
receipt verifies. Any client implementation can be dropped into that harness.
~~~~

### `specs/inference-receipts.md` (whole file)

~~~~markdown
# Inference settlement receipts (three-inference-receipt/v1)

The wire format that ties an x402 payment for inference work to the exact job
and response it paid for (Roadmap phase 4). When a paid inference call on
[`/api/x402/llm-proxy`](../api/x402/llm-proxy.js) settles, the response body
carries an `inferenceReceipt` object. Anyone holding the receipt can prove,
offline and from first principles, that a specific payment on a specific
network bought a specific metered job with a specific signed response. A node
operator uses the same receipt to prove they were paid for exactly the work
they performed.

- Spec id: `three-inference-receipt/v1` (receipt), `three-inference-response/v1` (metered job)
- Status: live on `/api/x402/llm-proxy` behind `INFERENCE_SIGNING_KEY` (unset
  disables signing and receipt issuance; the rollback toggle).
- Reference implementation: [`api/_lib/inference-settlement.js`](../api/_lib/inference-settlement.js)
- Persistence: `inference_jobs` table, [`api/_lib/migrations/20260812000000_inference_jobs.sql`](../api/_lib/migrations/20260812000000_inference_jobs.sql)
- Verifiers: `POST /api/x402/inference-verify` (free, HTTP) and
  [`scripts/inference-receipt-verify.mjs`](../scripts/inference-receipt-verify.mjs) (offline CLI)
- Relationship to OIN: [OPEN_INFERENCE_PROTOCOL.md](OPEN_INFERENCE_PROTOCOL.md)
  signs GPU worker job envelopes; this spec settles LLM inference over the
  x402 payment rail. Same ed25519 primitive, different artifact.

## Design goals

1. **Payment bound to work, not to a timestamp.** The receipt commits to the
   sha256 of the exact prompt and the exact completion, the provider-reported
   token counts, the settlement transaction, the amount, the asset, the payer
   and the payTo. Changing any one byte of any committed field invalidates a
   signature.
2. **Two attributable identities.** The *response signature* answers "which
   node stands behind this output"; the *receipt signature* answers "which
   issuer vouches that this payment covered this job". They can be the same
   key (default) or distinct operator-controlled keys.
3. **Verify without trusting us.** Both signatures are ed25519 over
   domain-tagged canonical JSON, verifiable with any RFC 8032 implementation.
   The on-chain leg (settlement confirmation) is optional and read-only.
4. **No real funds in proof runs.** The test lane settles on Solana devnet
   (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`), which the platform's
   self-hosted facilitator already routes. Mainnet activation is a documented,
   owner-gated step (see "Activation" below).

## Canonical encoding

Identical construction to the 3D provenance credentials
([PROVENANCE_3D.md](PROVENANCE_3D.md)): JSON with object keys sorted
recursively, no whitespace, UTF-8. All digests are SHA-256 over canonical
bytes, hex-encoded lowercase. Signatures are ed25519 (RFC 8032) over

```
TAG || canonical_bytes
```

where `TAG` is a versioned domain-separation string so a signature from any
other three.ws signing scheme can never replay as an inference artifact:

| Artifact      | Tag                               |
| ------------- | --------------------------------- |
| Metered job   | `three-inference-response/v1\n`   |
| Receipt       | `three-inference-receipt/v1\n`    |

Signatures and public keys are base58 (Solana encoding), so an operator's
existing Solana keypair doubles as a signing identity.

## The metered job (`three-inference-response/v1`)

Produced by the node immediately after inference, before settlement. Lives on
the paid response body as `metering` and inside the receipt as `job`.

```jsonc
{
	"type": "three-inference-response/v1",
	"jobId": "9b2f…",              // uuid, one per paid request
	"route": "/api/x402/llm-proxy",
	"model": "llama-3.3-70b-versatile", // concrete model that produced the output
	"provider": "groq",               // provider lane that ran it
	"promptSha256": "a1b2…",          // sha256 hex of the raw prompt string
	"responseSha256": "c3d4…",        // sha256 hex of the raw completion text
	"inputTokens": 5,                 // provider-reported prompt tokens
	"outputTokens": 6,                // provider-reported completion tokens
	"tokensUsed": 11,                 // inputTokens + outputTokens
	"latencyMs": 312                  // optional, measured wall-clock
}
```

The prompt and completion themselves never appear in the receipt: only their
hashes. A verifier who holds the raw text re-derives the hashes; a verifier
who does not can still check both signatures and the on-chain settlement.

## The receipt (`three-inference-receipt/v1`)

Issued after the x402 settlement lands, attached to the paid response body as
`inferenceReceipt`, and persisted server-side in `inference_jobs`.

```jsonc
{
	"receiptType": "three-inference-receipt/v1",
	"issuedAt": "2026-08-12T00:00:00.000Z",
	"job": { /* the metered job above, verbatim */ },
	"responseSignature": "4xY…",   // ed25519 by responseSigner over the job core
	"responseSigner": "NodePub…",  // base58 node key (INFERENCE_SIGNING_KEY)
	"payment": {
		"network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", // CAIP-2
		"payer": "BuyerWallet…",
		"payTo": "OperatorWallet…",
		"amountAtomics": "5000",     // decimal string, 6-decimal USDC atomics
		"asset": "EPjFWdd5…",        // settlement mint / contract
		"transaction": "5KtR…"       // settlement tx signature / hash
	},
	"signer": "IssuerPub…",        // base58 receipt issuer (INFERENCE_RECEIPT_SIGNING_KEY)
	"signature": "3wQm…"           // ed25519 by signer over everything above
}
```

The receipt signature covers the entire object except `signature` itself.
`payTo` is the wallet that received the settlement: for platform-run
inference that is the platform receiver; for a third-party node operator it
is the operator's own wallet, which is what makes the receipt a proof of
payment *to the operator*.

## Verification procedure

`verifyInferenceReceipt()` (and both verifiers built on it) runs these checks
in order; each is reported individually:

| Check                  | Meaning                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `shape`                | receiptType, signature, signer, job, payment all present and typed.     |
| `receipt_signature`    | ed25519 verify of `signature` over the receipt core, key `signer`.      |
| `receipt_signer_trusted` | (when a signer is pinned) `signer` equals the pinned key.              |
| `response_signature`   | ed25519 verify of `responseSignature` over the job core, key `responseSigner`. |
| `prompt_binding`       | (when raw prompt supplied) sha256(prompt) equals `job.promptSha256`.    |
| `response_binding`     | (when raw content supplied) sha256(content) equals `job.responseSha256`. |
| `token_totals`         | `tokensUsed == inputTokens + outputTokens`, all non-negative integers.  |
| `payment_fields`       | network, payer, payTo, asset, transaction, amountAtomics all well-formed. |

The HTTP verifier and the CLI add one optional check on top:

| Check                | Meaning                                                              |
| -------------------- | ------------------------------------------------------------------- |
| `onchain_settlement` | `payment.transaction` confirmed on `payment.network` (read-only RPC). |

The lane for `onchain_settlement` comes from the receipt's own
`payment.network`, compared in full against the canonical id. A verifier that
guesses the lane can report a devnet payment as a mainnet one, which is a false
statement about where money moved; both verifiers did exactly that until the
phase-4 proof run caught it. A network with no public endpoint (the local test
lane, a private cluster) is reported by its id and needs an explicit `--rpc`
rather than being silently looked up on mainnet.

A receipt is **verified** when every requested check passes. `prompt_binding`
and `response_binding` are optional because a third party may hold only the
receipt, not the raw text; the receipt still proves payment-to-job binding
without them.

## Proving payment for work performed (operator flow)

1. Run paid inference; keep the `inferenceReceipt` from each response.
2. To prove a specific job was paid: `node scripts/inference-receipt-verify.mjs
   receipt.json --prompt "…" --content "…" --onchain`. Exit 0 means the
   receipt signature, the response signature, both content bindings, and the
   on-chain settlement all check out.
3. To audit a stream of jobs server-side: `inference_jobs` is queryable by
   `payer` or `tx_hash` (`api/_lib/inference-jobs.js` `listInferenceJobs`).

## Activation and lanes

A `payment.network` is a CAIP-2 id: `solana:` followed by the first 32 base58
characters of that cluster's genesis hash. The id therefore *identifies the
ledger*, which is what lets a receipt state where the money moved. The rail's
one definition of the Solana lanes lives in
[`api/_lib/x402/solana-networks.js`](../api/_lib/x402/solana-networks.js).

- **Local test lane (default for proof runs):** a `solana-test-validator` on
  the operator's machine. It is the reproducible lane: unlimited SOL, an SPL
  mint the proof creates for itself, and no shared faucet to be rate-limited
  by. A test validator generates a fresh genesis on every reset, so the lane's
  id is derived at runtime from `getGenesisHash` and passed to the rail in
  `X402_SOLANA_LOCAL_NETWORK`. That variable is unset in every deployed
  environment, so the recognized networks there remain mainnet and devnet.
  The lane is named honestly: settling on a local validator while labelling
  the receipt as devnet would put a false chain id inside a signed attestation.
- **Devnet:** `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`, settled by the same
  self-hosted facilitator with every check above running identically. It is the
  shared public lane; its faucet is rate-limited per IP and is frequently dry on
  shared CI egress, which is why the local lane is the default. No real funds
  move on either.
- **Mainnet:** the same receipt format with `payment.network` =
  `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` (or any EVM lane the rail
  settles). Activation is setting `INFERENCE_SIGNING_KEY` (and optionally a
  distinct `INFERENCE_RECEIPT_SIGNING_KEY`) on the Cloud Run service env, an
  owner-gated deploy step. With the key unset, responses ship unsigned and no
  receipts are issued: that is the rollback position.

## The proof run

[`scripts/inference-settlement-proof.mjs`](../scripts/inference-settlement-proof.mjs)
settles one real metered job end to end and verifies its receipt. It runs a
real completion through the provider chain, signs the metered job, creates its
own 6-decimal SPL mint on the test ledger, builds an `exact` payment with the
reference client, puts it through `verifyPayment` → `settlePayment`, issues the
receipt, and verifies it (including a tamper check and the on-chain leg). Every
identity in the run is a throwaway keypair; no real asset appears anywhere.

Two production guards stay ON during the proof and are pointed at the run's own
throwaway payee and test mint rather than disabled: the facilitator's payTo
allowlist (`X402_SELF_FACILITATOR_PAYTO_ALLOWLIST`) and its settleable-mint pin
(`X402_ASSET_MINT_SOLANA`). A third, the DB-backed settle-credit gate
([`api/_lib/x402/settle-credit.js`](../api/_lib/x402/settle-credit.js), one
on-chain signature credits at most one payment), fails closed without a
database, so the proof brings a local Postgres rather than relaxing it. The
script header lists the containers.

The facilitator is served on loopback for the run. With the self-hosted
facilitator enabled the rail resolves it to `${APP_ORIGIN}/api/x402-facilitator`
and calls it over HTTP, and `APP_ORIGIN` defaults to `https://three.ws`, so a
proof run left alone would ask production to co-sign a test-lane payment.

## Interop requirement: memos

The reference x402 SVM client (`@x402/svm`, which
[`buildSolanaExactPayload`](../api/_lib/x402/a2a-client.js) delegates to)
attaches an SPL Memo to every `exact` payment it builds. Any facilitator
settling these payments must accept the Memo program
(`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`, and the legacy
`Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo`) as a no-op instruction: memo
owns no accounts and moves no lamports. Our own facilitator refused them until
this proof run surfaced it, which made every standards-built payment
unsettleable while our ring's own memo-free transactions passed. Covered by
[`tests/x402-facilitator-memo-interop.test.js`](../tests/x402-facilitator-memo-interop.test.js).

## Security notes

- Signing keys are ed25519 and MUST be distinct from every `X402_PAY_TO_*`
  wallet and from `X402_RECEIPT_SIGNING_KEY` (the secp256k1 EIP-712 key).
  These keys only attest; they never custody funds.
- The domain tags are load-bearing: never sign untagged bytes with these
  keys, and never accept an inference artifact without its tag.
- The receipt commits to the settlement transaction but does not itself prove
  confirmation; run the `onchain_settlement` check (or look the tx up) when
  finality matters. An RPC outage must read as "unverifiable", never as
  "confirmed".
~~~~

