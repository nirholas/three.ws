---
slug: agora-cartographer-profession-reactivation
title: Agora citizens work as cartographers again, with diorama compose running inside the job budget
tier: P3
score: 30
area: agora
sources: workers/agora-citizens/work/README.md, workers/agora-citizens/README.md, api/diorama.js
---

## Why this matters

Agora citizens advertise seven working professions; the eighth, cartographer (capability bit 3), is fully written in `workers/agora-citizens/work/cartographer.js` but deliberately left out of `WORK_RUNNERS` because `/api/diorama` `compose` decomposes a scene with an LLM chain whose latency overruns the job budget. Until compose fits the budget, jobs requiring that capability can never be completed by any citizen, and the profession is a hole in the civilization's skill set. The note in `workers/agora-citizens/work/index.js` says re-activation is a one-line re-add once the route runs in budget.

## Current state (measured by the reviewer on 2026-11-03)

- `WORK_RUNNERS` in `workers/agora-citizens/work/index.js` holds 7 professions; the cartographer comment block explains the omission.
- `workers/agora-citizens/work/cartographer.js` calls `POST /api/diorama` `{action:'compose', prompt}` through `httpJson` in `work/_skills.js`, which passes an optional `signal` and has no default timeout.
- `api/diorama.js` routes `compose` to `composePlanFromPrompt` in `api/_lib/diorama-build.js`. `three-ws-api` Cloud Run request timeout is 900 s, so the budget in question is the citizen's job window, not the service.
- Tests present: `tests/agora-work-proof.test.js`, `tests/agora-worker-image.test.js`; none exercises the cartographer runner.
- The compose latency has not been measured by the reviewer.

## Step 0: re-derive the current state

```bash
cd /home/user/three.ws
sed -n 30,60p workers/agora-citizens/work/index.js
grep -n "taskDeadlineSecs\|WORK_TIMEOUT\|workBudget" workers/agora-citizens/*.js workers/agora-citizens/work/*.js | head
node --input-type=module -e "import {composePlanFromPrompt} from './api/_lib/diorama-build.js'; for (const p of ['a lonely lighthouse on a stormy cliff','a cozy campsite in a pine clearing at dusk']) { const t=Date.now(); try { const r=await composePlanFromPrompt(p); console.log(p, Date.now()-t,'ms', Object.keys(r||{})); } catch(e){ console.log('fail', e.message, Date.now()-t); } }"
```

Record p50 and p95 over at least 10 runs before choosing a path below.

## Tasks

1. Measure compose latency (Step 0) and write the numbers into the order report and into `workers/agora-citizens/work/README.md`.
2. Pick the in-budget path based on data: if p95 is under the citizen job window, just add a per-call timeout and re-enable. If not, add a fast compose lane: a `mode:'fast'` option in `composePlanFromPrompt` that uses the smallest suitable Vertex AI Gemini model (GCP credits pre-approved) with a constrained JSON schema and a hard output cap, falling back to the full chain only for non-citizen callers. Keep the output plan schema identical so `@three-ws/scene` and the proof hash still work.
3. Test-first: `tests/agora-cartographer-runner.test.js` using the real runner against a locally started handler for `api/diorama.js` (or the real function with its LLM transport swapped only at the HTTP boundary by a recorded response captured from step 1), asserting the deliverable is the canonical plan, the proof is the sha256 of its canonical JSON, a timeout surfaces a clean typed failure (no fake success), and the runner is deterministic for a fixed brief.
4. Add `AbortSignal.timeout` to the cartographer call, sized from the measured p95 plus margin and read from config.
5. Re-add `cartographer` to `WORK_RUNNERS`; update `ACTIVE_PROFESSIONS` consumers (grep for it) and `docs/agora.md` roster text; remove the "deferred" comment block.
6. Confirm the capability bit mapping in the job board and read-model tests still holds: run `tests/agora-job-board.test.js`, `tests/agora-task-supply.test.js`, `tests/agora-read-model.test.js`.
7. Changelog entry and `npm run build:pages` if the roster is user visible.

## Definition of done

- [ ] `grep -n cartographer workers/agora-citizens/work/index.js` shows it inside `WORK_RUNNERS`.
- [ ] `npx vitest run tests/agora-cartographer-runner.test.js tests/agora-work-proof.test.js tests/agora-job-board.test.js tests/agora-task-supply.test.js` passes.
- [ ] The measured p95 of the compose path used by citizens is documented and under the configured job window.
- [ ] No stub or fake plan appears in any code path (a failed compose throws a typed error).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| LLM chain credentials missing locally | Take them from the three-ws-api Cloud Run env via the self-unblock playbook; use Vertex AI under the pre-approved GCP credits |
| Compose is inherently slow | Build the fast lane in Task 2 rather than raising timeouts without bound |
| A devnet citizen cannot be run | The runner test needs no chain; do not touch the chain-side tests |
