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
   ├─ 2. VISION JUDGE ─────────── render + vision chain, ~15-30 s
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

**Realism**, asked with [`buildJudgePrompt`](../api/_lib/quality-bench.js) from
the realism regression bench. The prompt is *imported, never forked*, so the
catalog gate and the bench can never disagree about what a score of 7 means. Four dimensions on a
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

The vision phase (below) reuses the same column and the same bound with one
difference in the outcome: a row in `mesh_passed` has already passed the
deterministic stage, so once its vision attempts are spent it is **published**
on the mesh verdict, marked `vision_unavailable`, rather than buried in
`gate_error`. Vision fails soft at the job level exactly as it does inside the
verdict.

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
page handed to the GLB parser as mesh bytes), and each provider attempt the
in-process judge makes is bounded at 20 s, so one hung rung falls through to the
next well inside the vision cron's per-asset budget.

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
| `inProcessTransport()` | Cloud Run (the vision cron) | [`render-clip.js`](../api/_lib/render-clip.js) in process | `describeImage()` from [`vision.js`](../api/_lib/vision.js), Workers AI first |
| `remoteTransport({ origin })` | A workstation with no GCP credentials | `POST /api/render/avatar-clip` | `POST /api/vision` |
| `localJudgeTransport({ origin })` | A workstation measuring a vision-chain fix before it deploys | `POST /api/render/avatar-clip` | `describeImage()` from [`vision.js`](../api/_lib/vision.js) in this process |

All three share one body (`buildTransport`) and differ only in where the render
happens and which process calls the model, so their accept rates stay
comparable. `inProcessTransport` used to call Vertex Gemini directly for both
questions with nothing behind it; with Vertex on a project billing hold since
2026-11-01 that made every in-process verdict `unavailable` while the other two
kept judging, so it now goes through the same provider chain. The in-process and
local judges ask Workers AI's Llama 4 Scout first (the rung measured to return
bare JSON 8 times in 8, see `QUALITY_GATE_VISION_LEAD` in
[`forge-quality-gate.js`](../api/_lib/forge-quality-gate.js)); on 2026-11-04 every
other rung was down at once (NIM 404, the free OpenRouter routes 429, Vertex and
OpenAI on billing holds). The prompts did not change, so `SEED_GATE_VERSION`
stays at 1. Both ask for the verdict through `askJson`, which gives a model that
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
| `SEED_VISION_PHASE` | off | Two-phase gate: the seed cron stops after the mesh gate and the vision cron judges (see below) |
| `SEED_VISION_BATCH` | 2 (max 6) | `mesh_passed` rows the vision cron claims per tick |
| `SEED_VISION_TICK_MS` | 50,000 | Wall-clock budget for one vision-cron tick |
| `SEED_VISION_ASSET_MS` | 40,000 | Budget for one asset's render + judge in the vision cron |
| `SEED_CRON_VISION` | off | Legacy: runs stage 2 inline in the seed cron. Ignored while `SEED_VISION_PHASE` is on |
| `SEED_CRON_VISION_MS` | 20,000 | Budget for the legacy inline stage 2 |
| `SEED_CRON_RIG` | **on** | Auto-rigs accepted avatars before publishing (`0` to publish static). Only shapes `riggableShape()` accepts are sent |

### The vision phase: stage 2 in a cron of its own

Stage 2 never ran in the seed cron in production. That cron has a hard 70-second
wall and a history of 504s when a phase overruns, and a render plus two judge
calls costs most of it, so the catalog was gated on structure but not on
appearance. With `SEED_VISION_PHASE=1` the work is split across two crons:

```
generated ──► forge-seed-cron: mesh gate
                 │ fails ──────────────► rejected (forge/rejected/)
                 │ passes
                 ▼
             mesh_passed  (mesh verdict stored, mesh_passed_at = now)
                 │
                 ▼  forge-seed-vision-cron, every minute
             claim (lease) ──► render + judge
                 │ accepted ──────────► rigging / done (published)
                 │ rejected ──────────► rejected (forge/rejected/ + sidecar)
                 │ judge unreachable ─► stays mesh_passed, gate_attempts + 1
                 │     attempts spent, or waited > 30 min
                 │                   ──► done, marked vision_unavailable
```

[`api/cron/forge-seed-vision-cron.js`](../api/cron/forge-seed-vision-cron.js)
claims up to `SEED_VISION_BATCH` rows, oldest first, with one `UPDATE` over a
`FOR UPDATE SKIP LOCKED` subselect that writes `vision_lease_until` (two
minutes). The lease, not the row lock, is what keeps an overlapping tick off a
row: the serverless driver commits every statement on its own, so the lock is
gone the moment the claim returns. A tick that dies mid-judge frees its rows when
the lease expires, and a row the tick has no time left for is handed back at
once. Every transition out of `mesh_passed` is a compare-and-set on the status,
so two ticks (or the sweep below) can never both publish one creation.

Publishing, rigging and quarantine go through
[`api/_lib/seed-publish.js`](../api/_lib/seed-publish.js), the same module the
seed cron uses, so an asset judged in the vision phase is written exactly like
one gated inline.

**Fail soft, bounded.** A judge that cannot be reached is retried on the next
tick, counted in `gate_attempts` up to `GATE_MAX_ATTEMPTS` (3). After that the
keeper is published on its mesh verdict with `vision.status = 'unavailable'`.
That is a deliberate choice: the mesh already passed the deterministic stage, and
burying a finished, structurally sound asset because a provider was down is the
failure the retry rule exists to prevent. The accept rate stays honest because it
is computed over judged assets only.

**The 30-minute bound.** No row waits in `mesh_passed` longer than
`MESH_PASSED_MAX_WAIT_MS` (30 minutes). The vision cron publishes a row past the
bound on its mesh verdict, and the seed cron's `vision_sweep` phase does the same
for up to five stale rows per tick, so even a vision cron that is not running
(not deployed, unscheduled, crashing on boot) never strands an asset. The vision
cron also drains `mesh_passed` with the flag off, so turning it off mid-flight
leaves nothing behind.

**Budget, measured.** On 2026-11-04, `scripts/gcp/seed-vision-measure.mjs` over
the 10 most recent published seeds (all gate version 1) judged all 10 with the
chain judge: 8 accepted, 2 rejected (one off-prompt scarf, one figure with an
incomplete body), an 80% accept rate, at a p50 of 20.5 s and a max of 28 s per
asset including the render. `SEED_VISION_ASSET_MS` defaults to 40 s for that
reason; the inline 20 s budget would have turned most assets into retries. A
real tick on a synthetic clone of a published row ran in 16 to 18 s end to end,
on both the publish and the quarantine path. Throughput is not the constraint:
the seed cron publishes single digits per hour.

Measure before and after flipping the flag (read-only, writes nothing):

```sh
node scripts/gcp/seed-vision-measure.mjs --limit=10                # live chain via /api/vision
node scripts/gcp/seed-vision-measure.mjs --limit=10 --judge=local  # chain judge in this process
```

Turning it on, after the code that knows `mesh_passed` is deployed:

```sh
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars SEED_VISION_PHASE=1
```

Rollback is the same command with `SEED_VISION_PHASE=0`: the seed cron goes back
to publishing straight after the mesh gate, and any rows already parked are
still judged (or swept) as above. Use `--update-env-vars` (merges), never
`--set-env-vars` (replaces the entire set). Watch the vision cron's tick
responses (`published`, `rejected`, `retries`, `vision_unavailable`,
`duration_ms`) and the `forge/rejected/` prefix afterwards.

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
