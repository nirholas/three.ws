# Run the catalog vision gate on its own cron so seeded models are judged on appearance, not just structure

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/748-plan-seed-vision-gate-own-cron.md`.

**Priority:** P2, new capability with clear value (score 44 of 100 inside the tier). **Area:** forge. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Every platform-seeded model in `/characters` and `/objects` is meant to clear two gates: mesh sanity and a vision judge (realism plus rig-readiness). In production the vision stage is deliberately off inside `api/cron/forge-seed-cron.js` because the function has a 70 s wall and a render plus two judge calls costs 10 to 20 s, so the public catalog is gated on structure only. A visitor browsing the catalog never asked for seeded content; a model that is structurally valid but ugly, a bust, or a crowd (unrigabble) still ships. The fix is to give the vision stage its own time budget instead of leaving it off.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `api/_lib/seed-quality.js` implements both stages, three transports (`inProcessTransport`, `remoteTransport`, `localJudgeTransport`), `evaluateSeedAsset`, `quarantineReject` and `SEED_GATE_VERSION`. Tests: `tests/seed-quality.test.js`, `tests/seed-mesh-gate.test.js`, `tests/cron-seed-gate-record.test.js`, `tests/cron-seed-pending-stall.test.js`.
- `api/cron/forge-seed-cron.js` runs every minute (`vercel.json` crons) and gates `generated` rows; vision only runs when `SEED_CRON_VISION=1` (budget `SEED_CRON_VISION_MS`, default 20 s, max 45 s). Row states seen in the file: `generated`, `rejected`, `published`, `gate_error` (after `GATE_MAX_ATTEMPTS` = 3).
- The bulk runner `scripts/gcp/seed-avatars.mjs` already runs both stages without the wall.
- No separate vision phase or cron exists.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n "SEED_CRON_VISION\|visionGateEnabled\|allowVision" api/cron/forge-seed-cron.js | head -20
grep -n "forge-seed" vercel.json | head
gcloud run services describe three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 --format='value(spec.template.spec.containers[0].env)' | tr ';' '\n' | grep -i SEED_CRON
grep -n "status" api/cron/forge-seed-cron.js | grep -n "set status" | head -20
npm run db:status
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Design the two-phase flow in code, not as a flag flip: phase 1 (existing cron) keeps the mesh gate and, on pass, moves the row to a new state `mesh_passed` (migration in the repo's migrations dir; read `npm run db:status` first because `npm run db:migrate` applies immediately) instead of publishing. A new endpoint `api/cron/forge-seed-vision-cron.js` (registered in `vercel.json` crons, every minute, `requireCron`, wrapped with `wrapCron`) claims up to N `mesh_passed` rows with `for update skip locked`, runs `evaluateSeedAsset` with `inProcessTransport()` under its own wall-clock budget (derive N from the 70 s wall and the measured 10 to 20 s per asset; one or two per tick), then publishes through the exact same publish/rig path phase 1 uses today (extract that path into a shared module rather than duplicating it) or quarantines through `quarantineReject`.
2. Keep fail-soft semantics: an unreachable judge publishes on the mesh verdict marked `vision_unavailable` (never counted as a quality reject), a judge throw before a verdict increments `gate_attempts` and retries up to `GATE_MAX_ATTEMPTS`, then publishes mesh-only as `vision_unavailable` instead of burying the mesh (state the choice in the doc). Add a `mesh_passed` staleness bound so a row never waits more than 30 minutes for the vision phase.
3. Tests first, in `tests/cron-seed-vision.test.js` beside the existing cron-seed tests: row in `mesh_passed` with a judge that accepts publishes; judge rejects quarantines to `forge/rejected/` with the verdict sidecar; judge throws twice then succeeds retries; judge down past the bound publishes with `vision_unavailable`; two concurrent ticks never double-claim a row. Run them red against the missing module, then implement.
4. Keep `SEED_CRON_VISION` semantics backward compatible: with it unset the phase-1 cron still works (publishes after the mesh gate, as today) so a rollback is one env var. Default the new flow on only via a new `SEED_VISION_PHASE=1` env documented in `docs/seed-quality.md`; leave the production flip as a config-only `gcloud run services update --update-env-vars SEED_VISION_PHASE=1` step in the report.
5. Measure on real rows: run the vision cron against 10 recent published seeded assets using `scripts/gcp/seed-avatars.mjs`'s judge path (`--judge=local` if no GCP creds locally) and report the accept rate by `SEED_GATE_VERSION`; do not change thresholds in this order.
6. Update `docs/seed-quality.md` (replace "Why stage 2 is off by default in the cron"), the `STRUCTURE.md` row for the catalog quality gate, and `data/changelog.json`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/cron-seed-vision.test.js tests/seed-quality.test.js tests/seed-mesh-gate.test.js tests/cron-seed-gate-record.test.js tests/cron-seed-pending-stall.test.js` passes.
- [ ] `grep -c forge-seed-vision-cron vercel.json` is at least 1 and `npm run check:rules -- --paths api/cron/forge-seed-vision-cron.js` exits 0.
- [ ] With the flag on locally against the dev DB, a `mesh_passed` row ends in `published` or `rejected` within one tick, observed in `forge_seed_jobs`; with the flag off, behavior is unchanged.
- [ ] One tick of the new cron against real recent rows completes in under 60 s wall (log the duration).
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Vertex credentials locally | Use `remoteTransport({origin})` or `localJudgeTransport` against the production origin as `docs/seed-quality.md` describes; the decision code path is shared |
| Migration risk | Read `npm run db:status` first; the migration only adds a state value / column and is applied with `npm run db:migrate`; no dry run exists, so review the SQL twice |
| Tick still overruns 70 s | Lower the per-tick claim count to 1 and `SEED_CRON_VISION_MS`; never raise the wall |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/748-plan-seed-vision-gate-own-cron.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `748-plan-seed-vision-gate-own-cron.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/seed-quality.md` (section "The catalog quality gate")

~~~~markdown
# The catalog quality gate

**Nobody asked for the assets the platform seeds into its own catalog, so they
have to earn their slot.** This is the gate that decides whether a
platform-generated model is published to [/characters](https://three.ws/characters)
and [/objects](https://three.ws/objects), or quarantined and never shown.

It matters because the failure is asymmetric. A user who generates a coarse mesh
in the [Forge](https://three.ws/create) chose to, and can regenerate. A visitor
browsing the catalog did not choose anything: every entry is the platform
vouching for itself. One melted blob on the storefront costs more trust than ten
rejected generations cost compute.

Source: [`api/_lib/seed-quality.js`](../api/_lib/seed-quality.js) ·
Tests: [`tests/seed-quality.test.js`](../tests/seed-quality.test.js) ·
Caller: [`api/cron/forge-seed-cron.js`](../api/cron/forge-seed-cron.js)

## Two stages, cheapest first

```
GLB bytes
   │
   ├─ 1. MESH SANITY ──────────── free, deterministic, no model call
   │      fails ──► quarantine (forge/rejected/) ──► never published
   │      passes
   │
   ├─ 2. VISION JUDGE ─────────── render + Vertex Gemini, ~10-20 s
   │      fails ──► quarantine ──► never published
   │      unreachable ──► publish anyway, flagged vision_unavailable
   │      passes
   │
   └─ published to the public catalog
```

The ordering is the cost control: **a degenerate blob never reaches a vision
model.** It is rejected in stage 1 for the price of a GLB fetch. Stage 2 only
ever sees assets that are already structurally sound.

### Stage 1: mesh sanity

Deterministic, runs on the GLB bytes, no network beyond fetching them. It reuses
[`scoreGlbQuality`](../api/_lib/glb-quality.js), the same scorer the interactive
forge flow already trusts, then applies catalog-specific bounds on top.

| Reason | Meaning | Default bound |
| --- | --- | --- |
| `not_valid_glb` | The bytes are not a binary glTF 2.0 at all | - |
| `degenerate_triangles` | Almost no triangle geometry; renders as nothing | `FORGE_QUALITY_MIN_TRIS` = 80 |
| `vertices_below_floor` | Too coarse to look like anything | `SEED_GATE_MIN_VERTICES` = 1,500 |
| `vertices_above_ceiling` | Runaway output | `SEED_GATE_MAX_VERTICES` = 1,500,000 |
| `file_too_small` | Structurally empty | `SEED_GATE_MIN_BYTES` = 20,000 |
| `file_too_large` | Would blow the viewer's fetch budget | `SEED_GATE_MAX_BYTES` = 80 MB |
| `no_textures` | Flat untextured grey | `SEED_GATE_REQUIRE_TEXTURE` = on |
| `zero_volume` | Collapsed bounding box; renders as a speck | - |
| `too_many_meshes_for_a_character` | A scene, not a character (avatars only, >8 meshes) | - |

Every failing bound is reported at once, not just the first, so tuning works off
the complete picture of what was wrong with an asset.

Two deliberate asymmetries:

- **Stricter than the interactive flow.** The `requireTexture` rule would be
  wrong for a user's own generation; it is right for a storefront.
- **Category-aware.** A prop may legitimately be a loose collection of parts, so
  the mesh-count rule applies to `avatar` only.

### Stage 2: vision judge

Renders one view and asks a vision model two separate questions.

**Realism**, via [`judgeOnce`](../api/_lib/quality-bench.js) from the realism
regression bench. It is *imported, never forked*, so the catalog gate and the
bench can never disagree about what a score of 7 means. Four dimensions on a
1-10 scale: `photorealism`, `geometryIntegrity`, `textureFidelity`,
`promptAdherence`.

| Reason | Default floor |
| --- | --- |
| `geometry_below_floor` | `SEED_GATE_MIN_GEOMETRY` = 5 |
| `prompt_adherence_below_floor` | `SEED_GATE_MIN_ADHERENCE` = 5 |
| `mean_score_below_floor` | `SEED_GATE_MIN_MEAN` = 4.5 (mean of all four) |

An asset can clear both individual floors and still fail on the mean:
structurally sound and prompt-faithful, but too poor overall to earn a slot.

**Rig readiness**, the question the realism bench does not ask: *can this be
rigged and animated at all?* Answered as strict JSON so the gate is a decision,
not a paragraph to interpret.

| Reason | The failure it catches |
| --- | --- |
| `vision_blob` | An amorphous, unrecognisable mass |
| `vision_subject_missing` | The requested subject is not there |
| `vision_multiple_subjects` | A crowd, a duplicated figure, or a scene |
| `vision_incomplete_body` | A waist-up bust or a headless torso |
| `vision_fused_limbs` | Arms welded to the torso, legs melted together |

`vision_fused_limbs` is skipped for `accessory`: a sword has no limbs, and
applying the rule would reject every prop.

## Fail closed on mesh, fail soft on vision

This is the single most important behaviour in the module, and it exists so the
numbers stay honest:

- **Mesh failure is a quality rejection.** Deterministic, reproducible, never
  published.
- **Vision failure is an infrastructure problem, not a quality signal.** If the
  renderer or the judge cannot be reached, the asset is published on the mesh
  verdict alone and marked `vision_unavailable`.

Recording a Vertex quota error as a quality reject would quietly corrupt the
accept-rate statistics, and you would tune thresholds against an outage. The
verdict carries `vision.status` (`judged` / `skipped` / `unavailable`) so the
accept rate can always be computed over the assets that were actually judged.

## A gate that cannot run is retried, not buried

The distinction above (quality verdict vs infrastructure) also decides what
happens to the *job row*. When the gate itself throws before reaching a verdict
(the object-storage read fails, the renderer dies, the judge transport is
unreachable), `api/cron/forge-seed-cron.js` leaves the row in `generated` and
counts the attempt in `forge_seed_jobs.gate_attempts`. The next tick re-gates it.
Only after `GATE_MAX_ATTEMPTS` (3) does the row move to the terminal `gate_error`
state.

That bound matters in both directions. Nothing ever revisits `gate_error`, so
burying a row on the first fault throws away a finished mesh that already cost
GPU time: on 2026-08-12 two seed jobs were lost that way inside one day, both to
the same transient storage error ("We encountered an internal error. Please try
again."). But an unbounded retry would let one ungateable mesh occupy a slot in
the `SEED_CRON_GATE` batch forever and starve every newer generation behind it.
Three attempts costs three ticks (three minutes) and then moves on.

Retries surface as `gate_retry` entries in the tick's `gate_results`, with a
`gate_retries` count on the response, so a lane that keeps blipping is visible
without reading the table.

Every read the gate makes is bounded so one slow host cannot stall the rest of
the tick: a lane's public GLB URL is fetched through the shared `fetchUpstream`
(30 s deadline, two attempts, and a non-2xx is a gate throw rather than an error
page handed to the GLB parser as mesh bytes), and the in-process Vertex judge
call carries a 45 s deadline with no retry.

## Rejects are kept, not deleted

A reject is copied (never moved, so the creator's forge history stays coherent)
to the `forge/rejected/` prefix, with a JSON sidecar beside it:

```
forge/rejected/<id>.glb
forge/rejected/<id>.reason.json
```

The sidecar carries the prompt, the category, the gate version and the entire
verdict. **That is the tuning dataset.** Threshold and prompt-wording changes are
made against real failures instead of guesses.

`SEED_GATE_VERSION` is stored on every verdict and bumped whenever a threshold or
judge prompt changes, because **an accept rate is only comparable within one gate
version.** Comparing last week's 62% against today's under different thresholds
is meaningless.

## Three transports, one gate

The gate runs from places with different credentials, so the model call is
behind a transport interface. The decision logic is identical either way, which
is the point: the bar cannot drift between how an asset arrives.

| Transport | Runs in | Render | Judge |
| --- | --- | --- | --- |
| `inProcessTransport()` | Cloud Run, GCP service account attached | [`render-clip.js`](../api/_lib/render-clip.js) in process | Vertex Gemini direct |
| `remoteTransport({ origin })` | A workstation with no GCP credentials | `POST /api/render/avatar-clip` | `POST /api/vision` |
| `localJudgeTransport({ origin })` | A workstation measuring a vision-chain fix before it deploys | `POST /api/render/avatar-clip` | `describeImage()` from [`vision.js`](../api/_lib/vision.js) in this process |

`remoteTransport` and `localJudgeTransport` share one body (`buildTransport`) and
differ only in which process calls the model, so their accept rates stay
comparable. Both ask for the verdict through `askJson`, which gives a model that
replied in prose exactly **one** more attempt with the format instruction
restated last. That retry never relaxes the verdict, only the format: a second
prose reply still fails. It exists because the free vision rungs occasionally
open with "The image shows...", and treating that as an infrastructure failure
recorded the asset as ungated and re-spent GPU time on the same prompt at the
next resume.

The bulk batch runner is [`scripts/gcp/seed-avatars.mjs`](../scripts/gcp/seed-avatars.mjs).
It has no 70 s function wall, so unlike the cron it runs **both** stages; pass
`--judge=local` to point its judge at `localJudgeTransport`.

## Using it

The two pure functions need no GPU, browser, or model, which is why they carry
the test coverage.

```js
import { gateMesh, decideVisionVerdict } from './api/_lib/seed-quality.js';
import { readFileSync } from 'node:fs';

// Stage 1 only: instant, free, works offline.
const verdict = gateMesh(readFileSync('./candidate.glb'), { category: 'avatar' });
console.log(verdict.pass, verdict.reasons);
// false [ 'vertices_below_floor', 'no_textures' ]
```

The full gate, as the cron runs it:

```js
import { evaluateSeedAsset, inProcessTransport } from './api/_lib/seed-quality.js';

const verdict = await evaluateSeedAsset({
  glbBuffer,                                   // the bytes, for stage 1
  glbUrl: 'https://three.ws/cdn/forge/abc.glb', // a public URL, for the renderer
  prompt: 'a knight in weathered plate armour',
  category: 'avatar',
  transport: inProcessTransport(),             // omit for a mesh-only run
});

if (!verdict.accepted) {
  await quarantineReject({ id, glbKey, prompt, verdict });
}
```

A verdict looks like this:

```json
{
  "gateVersion": 1,
  "accepted": false,
  "reasons": ["vision_incomplete_body"],
  "mesh": { "pass": true, "reasons": [], "flag": "ok", "rigged": true, "jointCount": 65 },
  "vision": {
    "status": "judged",
    "mean": 6.25,
    "realism": { "photorealism": 6, "geometryIntegrity": 7, "textureFidelity": 6, "promptAdherence": 6 },
    "rigReadiness": { "subjectPresent": true, "singleSubject": true, "complete": false, "note": "cut off at the waist" }
  },
  "transport": "in-process",
  "durationMs": 14320
}
```

Passing no `transport` runs stage 1 alone. That is not a degraded mode: it is the
cron's default, and it is a complete, meaningful verdict.

## The rig stage, after the gate

A verdict decides whether an asset is published. `SEED_CRON_RIG` decides what is
published: a rigged avatar or a static mesh. It has been **on by default since
2026-09-09**, after an audit found that zero of the 17,349 published seed avatars
had ever been rigged, because the stage was opt-in and nothing opted in. Every
catalog avatar was animating through the retarget fallback rather than its own
skeleton.

Not every accepted mesh is sent. `riggableShape()` in
[`forge-seed-cron.js`](../api/cron/forge-seed-cron.js) asks a different question
from the gate: not "is this worth publishing" but "does binding a humanoid rig
to it make it better or worse". It reads `thinAxis` and `planar`, which the mesh
stage already records. glTF is Y-up, so a mesh whose *thinnest* extent is Y is
lying down or standing in a slab, and the auto-rigger skins the slab along with
the figure: the first clip that moves the legs drags it across the scene. That is
not hypothetical. A seeded mesh (1.99 x 0.69 x 1.99) rigged cleanly by every
structural measure, 52-joint mixamorig skeleton and unit inverse binds, and then
shredded on screen the moment the idle clip played, while the same mesh published
static rendered correctly.

Every failure path keeps the asset. A refused shape, a rig fault, or a rig that
stops answering past `RIG_STALL_MS` (45 minutes) publishes the gated keeper
**static** rather than losing it, which is exactly what every seed avatar was
before the stage turned on. The verdict is now written onto the keeper row as
well as the reject, so a published entry carries the gate that let it through.

## Configuration

Gate thresholds (read at import, so a change needs a restart):

| Variable | Default |
| --- | --- |
| `SEED_GATE_MIN_VERTICES` / `SEED_GATE_MAX_VERTICES` | 1,500 / 1,500,000 |
| `SEED_GATE_MIN_BYTES` / `SEED_GATE_MAX_BYTES` | 20,000 / 80 MB |
| `SEED_GATE_REQUIRE_TEXTURE` | `1` (set `0` to allow untextured) |
| `SEED_GATE_MIN_GEOMETRY` / `SEED_GATE_MIN_ADHERENCE` | 5 / 5 |
| `SEED_GATE_MIN_MEAN` | 4.5 |

Cron knobs (read per call, so a Cloud Run env update applies on the next tick
with no redeploy):

| Variable | Default | Effect |
| --- | --- | --- |
| `SEED_CRON_BATCH` | 1 | Jobs started per tick, submitted two at a time |
| `SEED_CRON_MAX_PENDING` | 3 x batch | In-flight ceiling |
| `SEED_CRON_VISION` | off | Enables stage 2 inside the cron |
| `SEED_CRON_VISION_MS` | 20,000 | Wall-clock budget for stage 2 |
| `SEED_CRON_RIG` | **on** | Auto-rigs accepted avatars before publishing (`0` to publish static). Only shapes `riggableShape()` accepts are sent |

### Why stage 2 is off by default in the cron

`SEED_CRON_VISION` is deliberately unset in production. The seed cron has a hard
70-second wall and a history of 504s when a phase overruns, while a render plus
two judge calls costs 10-20 seconds of it. **Stage 1 always runs** (it is
deterministic, local, and costs only the GLB fetch), so the catalog is never
ungated: it is gated on structure but not yet on appearance.

Turning it on is a one-variable change with no deploy:

```sh
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars SEED_CRON_VISION=1
```

Use `--update-env-vars` (merges), never `--set-env-vars` (replaces the entire
set). Watch `forge_creations` and the `forge/rejected/` prefix afterwards: if
ticks start timing out, lower `SEED_CRON_VISION_MS` before turning it back off.

## Tuning the thresholds

1. Let rejects accumulate in `forge/rejected/`.
2. Read the `.reason.json` sidecars and group by `reasons[]`. One reason
   dominating a batch usually means a threshold is wrong, not that the generator
   regressed.
3. Change the threshold, **bump `SEED_GATE_VERSION`**, and compare accept rates
   only within a version.
4. Re-run `npx vitest run tests/seed-quality.test.js`. The tests assert against
   the exported bound constants rather than hardcoded numbers, so a deliberate
   threshold change stays green while a broken decision does not.

## Related

- [Realism quality bench](../data/quality-bench/README.md): the regression
  harness whose scorer this gate imports
- [The 3D viewer](./viewer.md): what a published catalog entry has to render in
- [Production log triage](./ops/production-log-triage.md): the operator runbook
  for the seeding pipeline
~~~~

### `docs/seed-quality.md` (section "Two stages, cheapest first")

~~~~markdown
## Two stages, cheapest first

```
GLB bytes
   │
   ├─ 1. MESH SANITY ──────────── free, deterministic, no model call
   │      fails ──► quarantine (forge/rejected/) ──► never published
   │      passes
   │
   ├─ 2. VISION JUDGE ─────────── render + Vertex Gemini, ~10-20 s
   │      fails ──► quarantine ──► never published
   │      unreachable ──► publish anyway, flagged vision_unavailable
   │      passes
   │
   └─ published to the public catalog
```

The ordering is the cost control: **a degenerate blob never reaches a vision
model.** It is rejected in stage 1 for the price of a GLB fetch. Stage 2 only
ever sees assets that are already structurally sound.

### Stage 1: mesh sanity

Deterministic, runs on the GLB bytes, no network beyond fetching them. It reuses
[`scoreGlbQuality`](../api/_lib/glb-quality.js), the same scorer the interactive
forge flow already trusts, then applies catalog-specific bounds on top.

| Reason | Meaning | Default bound |
| --- | --- | --- |
| `not_valid_glb` | The bytes are not a binary glTF 2.0 at all | - |
| `degenerate_triangles` | Almost no triangle geometry; renders as nothing | `FORGE_QUALITY_MIN_TRIS` = 80 |
| `vertices_below_floor` | Too coarse to look like anything | `SEED_GATE_MIN_VERTICES` = 1,500 |
| `vertices_above_ceiling` | Runaway output | `SEED_GATE_MAX_VERTICES` = 1,500,000 |
| `file_too_small` | Structurally empty | `SEED_GATE_MIN_BYTES` = 20,000 |
| `file_too_large` | Would blow the viewer's fetch budget | `SEED_GATE_MAX_BYTES` = 80 MB |
| `no_textures` | Flat untextured grey | `SEED_GATE_REQUIRE_TEXTURE` = on |
| `zero_volume` | Collapsed bounding box; renders as a speck | - |
| `too_many_meshes_for_a_character` | A scene, not a character (avatars only, >8 meshes) | - |

Every failing bound is reported at once, not just the first, so tuning works off
the complete picture of what was wrong with an asset.

Two deliberate asymmetries:

- **Stricter than the interactive flow.** The `requireTexture` rule would be
  wrong for a user's own generation; it is right for a storefront.
- **Category-aware.** A prop may legitimately be a loose collection of parts, so
  the mesh-count rule applies to `avatar` only.

### Stage 2: vision judge

Renders one view and asks a vision model two separate questions.

**Realism**, via [`judgeOnce`](../api/_lib/quality-bench.js) from the realism
regression bench. It is *imported, never forked*, so the catalog gate and the
bench can never disagree about what a score of 7 means. Four dimensions on a
1-10 scale: `photorealism`, `geometryIntegrity`, `textureFidelity`,
`promptAdherence`.

| Reason | Default floor |
| --- | --- |
| `geometry_below_floor` | `SEED_GATE_MIN_GEOMETRY` = 5 |
| `prompt_adherence_below_floor` | `SEED_GATE_MIN_ADHERENCE` = 5 |
| `mean_score_below_floor` | `SEED_GATE_MIN_MEAN` = 4.5 (mean of all four) |

An asset can clear both individual floors and still fail on the mean:
structurally sound and prompt-faithful, but too poor overall to earn a slot.

**Rig readiness**, the question the realism bench does not ask: *can this be
rigged and animated at all?* Answered as strict JSON so the gate is a decision,
not a paragraph to interpret.

| Reason | The failure it catches |
| --- | --- |
| `vision_blob` | An amorphous, unrecognisable mass |
| `vision_subject_missing` | The requested subject is not there |
| `vision_multiple_subjects` | A crowd, a duplicated figure, or a scene |
| `vision_incomplete_body` | A waist-up bust or a headless torso |
| `vision_fused_limbs` | Arms welded to the torso, legs melted together |

`vision_fused_limbs` is skipped for `accessory`: a sword has no limbs, and
applying the rule would reject every prop.
~~~~

### `docs/seed-quality.md` (section "Fail closed on mesh, fail soft on vision")

~~~~markdown
## Fail closed on mesh, fail soft on vision

This is the single most important behaviour in the module, and it exists so the
numbers stay honest:

- **Mesh failure is a quality rejection.** Deterministic, reproducible, never
  published.
- **Vision failure is an infrastructure problem, not a quality signal.** If the
  renderer or the judge cannot be reached, the asset is published on the mesh
  verdict alone and marked `vision_unavailable`.

Recording a Vertex quota error as a quality reject would quietly corrupt the
accept-rate statistics, and you would tune thresholds against an outage. The
verdict carries `vision.status` (`judged` / `skipped` / `unavailable`) so the
accept rate can always be computed over the assets that were actually judged.
~~~~

### `docs/seed-quality.md` (section "A gate that cannot run is retried, not buried")

~~~~markdown
## A gate that cannot run is retried, not buried

The distinction above (quality verdict vs infrastructure) also decides what
happens to the *job row*. When the gate itself throws before reaching a verdict
(the object-storage read fails, the renderer dies, the judge transport is
unreachable), `api/cron/forge-seed-cron.js` leaves the row in `generated` and
counts the attempt in `forge_seed_jobs.gate_attempts`. The next tick re-gates it.
Only after `GATE_MAX_ATTEMPTS` (3) does the row move to the terminal `gate_error`
state.

That bound matters in both directions. Nothing ever revisits `gate_error`, so
burying a row on the first fault throws away a finished mesh that already cost
GPU time: on 2026-08-12 two seed jobs were lost that way inside one day, both to
the same transient storage error ("We encountered an internal error. Please try
again."). But an unbounded retry would let one ungateable mesh occupy a slot in
the `SEED_CRON_GATE` batch forever and starve every newer generation behind it.
Three attempts costs three ticks (three minutes) and then moves on.

Retries surface as `gate_retry` entries in the tick's `gate_results`, with a
`gate_retries` count on the response, so a lane that keeps blipping is visible
without reading the table.

Every read the gate makes is bounded so one slow host cannot stall the rest of
the tick: a lane's public GLB URL is fetched through the shared `fetchUpstream`
(30 s deadline, two attempts, and a non-2xx is a gate throw rather than an error
page handed to the GLB parser as mesh bytes), and the in-process Vertex judge
call carries a 45 s deadline with no retry.
~~~~

### `docs/seed-quality.md` (section "Configuration")

~~~~markdown
## Configuration

Gate thresholds (read at import, so a change needs a restart):

| Variable | Default |
| --- | --- |
| `SEED_GATE_MIN_VERTICES` / `SEED_GATE_MAX_VERTICES` | 1,500 / 1,500,000 |
| `SEED_GATE_MIN_BYTES` / `SEED_GATE_MAX_BYTES` | 20,000 / 80 MB |
| `SEED_GATE_REQUIRE_TEXTURE` | `1` (set `0` to allow untextured) |
| `SEED_GATE_MIN_GEOMETRY` / `SEED_GATE_MIN_ADHERENCE` | 5 / 5 |
| `SEED_GATE_MIN_MEAN` | 4.5 |

Cron knobs (read per call, so a Cloud Run env update applies on the next tick
with no redeploy):

| Variable | Default | Effect |
| --- | --- | --- |
| `SEED_CRON_BATCH` | 1 | Jobs started per tick, submitted two at a time |
| `SEED_CRON_MAX_PENDING` | 3 x batch | In-flight ceiling |
| `SEED_CRON_VISION` | off | Enables stage 2 inside the cron |
| `SEED_CRON_VISION_MS` | 20,000 | Wall-clock budget for stage 2 |
| `SEED_CRON_RIG` | **on** | Auto-rigs accepted avatars before publishing (`0` to publish static). Only shapes `riggableShape()` accepts are sent |

### Why stage 2 is off by default in the cron

`SEED_CRON_VISION` is deliberately unset in production. The seed cron has a hard
70-second wall and a history of 504s when a phase overruns, while a render plus
two judge calls costs 10-20 seconds of it. **Stage 1 always runs** (it is
deterministic, local, and costs only the GLB fetch), so the catalog is never
ungated: it is gated on structure but not yet on appearance.

Turning it on is a one-variable change with no deploy:

```sh
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars SEED_CRON_VISION=1
```

Use `--update-env-vars` (merges), never `--set-env-vars` (replaces the entire
set). Watch `forge_creations` and the `forge/rejected/` prefix afterwards: if
ticks start timing out, lower `SEED_CRON_VISION_MS` before turning it back off.
~~~~

### `docs/seed-quality.md` (section "Why stage 2 is off by default in the cron")

~~~~markdown
### Why stage 2 is off by default in the cron

`SEED_CRON_VISION` is deliberately unset in production. The seed cron has a hard
70-second wall and a history of 504s when a phase overruns, while a render plus
two judge calls costs 10-20 seconds of it. **Stage 1 always runs** (it is
deterministic, local, and costs only the GLB fetch), so the catalog is never
ungated: it is gated on structure but not yet on appearance.

Turning it on is a one-variable change with no deploy:

```sh
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars SEED_CRON_VISION=1
```

Use `--update-env-vars` (merges), never `--set-env-vars` (replaces the entire
set). Watch `forge_creations` and the `forge/rejected/` prefix afterwards: if
ticks start timing out, lower `SEED_CRON_VISION_MS` before turning it back off.
~~~~

