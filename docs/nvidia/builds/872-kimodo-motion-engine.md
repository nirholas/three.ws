# Design: a Kimodo motion engine beside the current one

**Status:** planned, not built. Work order: [872](../../../prompts/finish/872-nvidia-22-kimodo-motion-engine.md). Written 2026-11-26. Part of the [NVIDIA build plan](README.md).

## What it is

three.ws turns a sentence ("walk forward and wave") into an animation clip that
plays on any rigged avatar. This build adds NVIDIA's Kimodo model as a second
engine for that, behind the one that serves today, and measures the two against
each other on the same prompts.

## Why build it

- Kimodo is NVIDIA's own text-to-motion model (released 2026-03-16, trained on
  700 hours of motion capture). Our motion lane has no NVIDIA-published model in
  it today ([research, Kimodo](../../nvidia-showcase-research.md#motion-kimodo)).
- A second engine is a real fallback: when the current one fails, the visitor
  still gets a clip.
- A measured comparison is useful either way. If Kimodo is better, the owner
  can promote it. If it is not, we know and say so.

## The one licensing rule

Only `Kimodo-SOMA-SEED-v1.1` is marked ready for commercial use. The SMPL-X and
G1 variants are research-only and are never downloaded into our bucket or
served. The text encoder's license is read too, because it ships alongside the
model.

## What exists today

| Piece | Where | What it does |
|---|---|---|
| The motion worker | [workers/model-text2motion/](../../../workers/model-text2motion/README.md) | MDM and MoMask samplers, output converted to our clip JSON by `smpl_to_clip.py` |
| The motion API | [api/forge-motion.js](../../../api/forge-motion.js), [api/motion.js](../../../api/motion.js) | Accepts the prompt, calls the worker at `GCP_TEXT2MOTION_URL` |
| The quality gate | [api/_lib/motion-quality.js](../../../api/_lib/motion-quality.js) | `gateMotionClip` checks a clip's shape, required bones and motion bounds before it is served |
| Seeds | [api/_lib/motion-seed.js](../../../api/_lib/motion-seed.js) | Makes results reproducible |
| Retargeting | [src/animation-retarget.js](../../../src/animation-retarget.js) | Maps the canonical skeleton to the visitor's rig in the browser |
| Health | [api/_lib/forge-health.js](../../../api/_lib/forge-health.js) | Lists `text2motion` with its URL variable |

## Design

```
prompt + seed
    |
motion API
    |-- current engine (unchanged request, still first)
    |        \-- fails -> Kimodo worker -> same clip JSON -> same quality gate
    \-- Kimodo variable unset -> exactly what happens today
```

- **A new worker, `workers/model-kimodo/`**, with the same request and response
  as the current motion worker, so the API needs no new shape.
- **The skeleton map is the real work.** Kimodo outputs a 30-joint SOMA skeleton
  (root translation plus joint rotations, 30 frames per second, 10 seconds at
  most). The worker converts that to our canonical skeleton with the same track
  names, rotation basis and root convention the current worker emits. Fixed-input
  tests prove it: a T-pose stays a T-pose, a 90 degree elbow bend lands on the
  right joint and axis, forward is forward.
- **Limits are stated, not hidden.** A request over 10 seconds gets a clear
  error naming the limit.
- **Memory.** The repository puts Kimodo at about 17 GB of VRAM, mostly the text
  encoder, which fits the GPUs we already use. The build measures it.

## Phases

| Phase | Exit condition |
|---|---|
| 1. Licenses | Clauses quoted for the code, the SOMA-SEED-v1.1 weights and the text encoder |
| 2. Skeleton map | Fixed-input tests pass; three clips play correctly on two different rigs in a browser |
| 3. Worker deployed | Cloud Run GPU service at minimum instances 0, maximum 1, away from the TRELLIS lane and the current motion service; cold and warm numbers measured |
| 4. Wired behind the current engine | Tests: current engine fails and Kimodo answers; the request to the current engine is byte-for-byte unchanged |
| 5. Comparison | The same 40 prompts through both engines with fixed seeds, scored |
| 6. Evidence | `docs/nvidia/evals/kimodo-motion-<date>.md`, docs and changelog |

## The numbers it leaves behind

Per category (walks, gestures, dances, sports, idles, sit and stand): success
rate, latency, the existing quality-gate scores, foot sliding, and prompt match
judged blind by a vision model already on our NVIDIA key.

## Cost

One GPU service that scales to zero and is called only when the current engine
has failed. Measured cost per clip goes in the eval doc. The existing keep-warm
job is not extended to it.

## Risks and fallbacks

| Risk | What we do |
|---|---|
| The text encoder's license forbids hosting | Stop and report. A research-only component is never substituted. |
| The skeleton map produces twisted limbs on some rigs | The fixed-input tests localize it to a joint and axis. Clips that fail the quality gate are never served. |
| Kimodo is slower or worse than the current engine | That is a finding. It stays second and the comparison is published as measured. |
| No GPU quota | Another region, quota request filed, everything else finished. |

## Owner steps

Push and deploy. Then read the comparison and decide whether Kimodo should
serve first for any category. The report gives the one-line change.

## What we can say, and when

Until it serves real requests: "Kimodo, under evaluation". After: "motion can be
generated by NVIDIA Kimodo", with the comparison linked.
