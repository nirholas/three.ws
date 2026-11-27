# Design: physics-checked simulation-ready assets

**Status:** planned, not built. Work order: [875](../../../prompts/finish/875-nvidia-25-physics-validated-simready.md). Written 2026-11-26. Part of the [NVIDIA build plan](README.md).

## What it is

Forge can already export a model as OpenUSD with collision shapes, mass and
labels, for use in simulators such as NVIDIA Isaac Sim. This build adds a check
that the asset actually behaves: drop it in NVIDIA's physics library, see that
it lands and comes to rest, render it with NVIDIA's sensor library, and confirm
the labels come back. The result goes in the export report and is shown to the
visitor.

## Why build it

- "Simulation-ready" is a claim. A drop test and a sensor render turn it into a
  result a robotics developer can trust.
- The startups NVIDIA named beside its July 2026 Omniverse libraries make
  simulation-ready assets, one of them from text prompts
  ([research, physical AI](../../nvidia-showcase-research.md#physical-ai-and-simulation-ready-assets)).
  We have the same pipeline and no proof that its output simulates.
- It produces a number nobody else in our position publishes: the pass rate of
  generated assets by object class.

## What exists today

| Piece | Where | What it does |
|---|---|---|
| The export worker | [workers/usd-export/](../../../workers/usd-export/README.md) | CPU-only service. Converts a GLB to `asset.usd`, `.usda`, `.usdz` and a zip, with CoACD convex collision, a rigid body, a physics material, mass from hull volume and a class density, semantic labels, and `report.json` |
| Validators | same | OpenUSD's `UsdValidation` and NVIDIA's `omniverse-asset-validator`. Any error fails the job. |
| A drop test | [workers/usd-export/drop_test.py](../../../workers/usd-export/drop_test.py) | Already written: loads an exported file into Newton (NVIDIA's open, Warp-based physics engine) on CPU, drops it, and checks mass, fall, settle and tunnelling. A developer tool today, not shipped in the image and not run for visitors. |
| The API side | [api/_lib/usd-export.js](../../../api/_lib/usd-export.js), [api/forge/export-usd.js](../../../api/forge/export-usd.js) | How the site calls the worker |

## What is not known yet

Read from NVIDIA's repositories in step 0: the licenses of ovphysx and ovrtx,
how they install (wheels, containers or a Kit dependency), and what GPU they
need.

## Design

```
export finishes (unchanged, never waits on the check)
    |
simulation check (optional, off unless asked for)
    |-- physics: drop from a small height in several orientations, step to rest
    |            records: settled?, penetration depth, energy growth, rest orientation, solver settings
    |-- sensor:  render the settled object from a fixed camera ring
    |            records: do the exporter's semantic labels come back in the annotation?
    |
report.json gains a "simulation" section  ->  shown beside the export in the UI
```

- **The export worker's behavior is pinned.** An export without the check is
  byte-for-byte what it is today. The check is a separate stage.
- **Where it runs depends on what the libraries need.** If they need a GPU: a
  new service, `workers/sim-validate/`, at minimum instances 0, away from the
  TRELLIS lane's quota, called after the export. If they run on CPU: an optional
  stage inside the export job behind a request flag that defaults to off.
- **The existing Newton drop test is the baseline.** It already encodes the pass
  criteria on CPU. If ovphysx cannot be used in a hosted commercial service, the
  build says so and finishes with the engine that can.
- **Thresholds live in code with the reason for each**, and the check is
  deterministic for a fixed seed.
- **The UI says what failed and what to try**, for example regenerating with a
  simpler shape. Not a bare badge.

## Phases

| Phase | Exit condition |
|---|---|
| 1. Licenses and install | Clauses quoted; install path and GPU need recorded |
| 2. Physics check | Deterministic settle result per orientation, with tests on known-good and known-bad assets |
| 3. Sensor check | Labels round-trip through a rendered annotation; frames stored in our bucket |
| 4. Placement | Runs as a service or an optional stage; an export without the check is unchanged, proven by a test |
| 5. Report and UI | `simulation` section in the report; a designed passed and failed state |
| 6. The number | 200 or more real exports checked; pass rates by class published |
| 7. Fixes | Failures the exporter controls are fixed test-first; anything that changes existing exports is left for the owner with before and after numbers |

## The numbers it leaves behind

Pass rate by object class over at least 200 real Forge exports, the common
failure causes, and time per asset. Published in
`docs/nvidia/evals/simready-physics-<date>.md`.

## Cost

At most one GPU service that scales to zero, or none if the check runs on CPU.
The 200-asset run reuses existing public creations and generates at most 3 new
models.

## Risks and fallbacks

| Risk | What we do |
|---|---|
| A library's license forbids hosted commercial use | Do not use it; finish with the one that permits it, or with Newton |
| The pass rate is low for some classes | That is the finding. Fix what the exporter controls, publish the rest as measured. |
| A fix would change exports for people who did not ask for the check | Reported with numbers and left for the owner |

## Owner steps

Push and deploy. Decide on any exporter change that alters existing exports.

## What we can say, and when

Until the check runs for real visitors: the libraries are "under evaluation".
After: "text to a simulation-ready asset that has been dropped, settled and
rendered", with the pass rates.
