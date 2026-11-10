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

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `docs/inference-node-operator.md`
- `specs/inference-nodes.md`
- `specs/inference-receipts.md`

## Status (2026-11-04)

Built: `POST /api/x402/node-inference` (flat price, handler verifies the node receipt before settlement), liveness tracking on poll, `expireJob`, earnings ledger and `GET /api/nodes/earnings`, `GET /api/nodes/list`, `/nodes` page, dry-run `scripts/inference-node-payouts.mjs`, e2e harness buyer step, spec and operator docs, vitest coverage. Remaining for the owner or a session with a browser and DB: apply migration `20261105050000_inference_node_earnings.sql` (`npm run db:status` first, then `db:migrate`; the code also creates the table lazily), run `node packages/node-operator/scripts/e2e-local.mjs` (downloads ~90MB of model weights), exercise `/nodes` in a browser, and run one real paid call. Order file kept.
