# Design: our own Audio2Face-3D face service

**Status:** planned, not built. Work order: [871](../../../prompts/finish/871-nvidia-21-self-hosted-audio2face-worker.md). Written 2026-11-26. Part of the [NVIDIA build plan](README.md).

## What it is

When an avatar on three.ws speaks, its face is supposed to be animated by
NVIDIA's Audio2Face-3D model: audio in, mouth and face movement out. Today we
ask NVIDIA's hosted copy of that model for every line. This build runs the same
model on our own NVIDIA GPU and uses it whenever the hosted copy does not
answer.

## Why build it

- The hosted lane answered 7 of 56 health probes in the 7 days to 2026-11-26.
  Most talking avatars therefore get the simpler fallback mouth, not real facial
  animation. This fixes a feature that is mostly broken.
- NVIDIA open-sourced Audio2Face on 2025-09-24. The SDK is MIT licensed and the
  weights are under the NVIDIA Open Model License
  ([research, digital humans](../../nvidia-showcase-research.md#digital-humans)).
- It turns "we call a NVIDIA API" into "we run NVIDIA's open model on our own
  NVIDIA GPUs with measured latency", which is the kind of sentence NVIDIA
  reshapes into a story.

## What exists today

| Piece | Where | What it does |
|---|---|---|
| The face endpoint | [api/a2f.js](../../../api/a2f.js) | Takes speech audio, returns a face track, answers 503 when no lane can serve |
| The hosted lane client | [api/_lib/a2f-nvidia.js](../../../api/_lib/a2f-nvidia.js) | Streams 16 kHz audio to NVIDIA over gRPC and reads back per-frame ARKit blendshape weights (the 52 ARKit shapes plus tongue) at 30 frames per second, with time codes in seconds. Includes a healer that follows NVIDIA's function id when it rotates. |
| Emotion on the wire | [api/_lib/a2f-emotion-wire.js](../../../api/_lib/a2f-emotion-wire.js) | How an emotion is sent with the audio |
| The browser player | [src/voice/a2f-player.js](../../../src/voice/a2f-player.js) | Plays the face track on ARKit, VRM, viseme or bone rigs |
| The fallback mouth | [src/voice/viseme-fallback.js](../../../src/voice/viseme-fallback.js), [src/voice/lipsync-driver.js](../../../src/voice/lipsync-driver.js) | What the visitor gets when there is no face track |
| Lane health | [api/_lib/nvidia-lanes.js](../../../api/_lib/nvidia-lanes.js), [api/cron/nvidia-lane-probes.js](../../../api/cron/nvidia-lane-probes.js) | Hourly probes, shown on `/nvidia` and `/api/nvidia/stats` |

## Design

```
speech audio
    |
api/a2f.js
    |-- hosted lane healthy?  yes -> NVIDIA hosted Audio2Face-3D (unchanged, still first)
    |                              \-- fails -> our service
    |-- hosted lane known down -> our service straight away (no hosted timeout for the visitor)
    |
    \-- our service unset or failing -> exactly what happens today (fallback mouth)
```

- **A new worker, `workers/model-a2f/`**, in the same layout as the other GPU
  workers: FastAPI, shared-key auth, weights pulled from
  `gs://three-ws-model-weights`, Cloud Build config, tests, README.
- **Same contract as the hosted lane.** It accepts the audio the hosted client
  already sends and returns the same frame shape, so the browser player does not
  change. If the open SDK outputs raw vertex motion and not blendshape weights,
  solving to the ARKit set is part of the worker.
- **TensorRT engine cache.** If an engine has to be built for the GPU it runs
  on, it is built once and stored in the bucket, keyed by model, GPU and
  TensorRT version, so a cold start loads it and does not rebuild it. How
  engines behave is read from the TensorRT documentation and measured, never
  assumed.
- **Placement.** The hosted lane keeps first position. Ours is second, behind an
  environment variable for its URL. With the variable unset the code path does
  not exist for a request.
- **Its own lane in the registry**, so its probes show beside the hosted lane's.

## Phases

| Phase | Exit condition |
|---|---|
| 1. License and model choice | The clauses that permit a hosted commercial service are quoted; the model variant is chosen on measured quality and latency |
| 2. Worker runs locally | Real audio in, a face track out in the hosted lane's exact shape, with tests |
| 3. Deployed | Cloud Run GPU service at minimum instances 0, maximum 1, in a region that does not compete with the TRELLIS lane; five cold starts and thirty warm requests measured |
| 4. Wired | `api/a2f.js` uses it on hosted failure; tests prove the hosted request is unchanged and that an unset variable leaves today's behavior |
| 5. Parity | At least ten clips through both lanes, curves compared per channel, mouth channels reported separately |
| 6. Evidence | Eval doc under `docs/nvidia/evals/`, lane visible on `/nvidia`, docs and changelog |

## The numbers it leaves behind

- Cold start and warm latency for 2, 8 and 20 second clips.
- Parity with the hosted lane (correlation and mean absolute difference).
- After deploy: the share of talking-avatar requests that receive real facial
  animation, before and after.

## Cost

One GPU service that scales to zero. It costs GPU seconds only while an avatar
is speaking and the hosted lane has failed. The eval doc states the measured
cost per request.

## Risks and fallbacks

| Risk | What we do |
|---|---|
| The weights license does not permit hosting | Stop and report with the clause. Do not ship. |
| Cold start is too slow for a spoken line | The first line after idle uses today's fallback mouth while the service warms; later lines use the service. No keep-warm is added. |
| No GPU quota in the chosen region | Try another region and file the quota request; finish everything else. |
| Output does not match the hosted lane closely | Report the parity numbers. It stays second and the owner decides. |

## Owner steps

Push and deploy. Then, with the eval doc in hand, decide whether ours should
serve first. The report gives the one-line change.

## What we can say, and when

Until it serves real visitors: "Audio2Face-3D SDK, under evaluation". After it
does: "facial animation runs on the open Audio2Face-3D SDK on our own NVIDIA
GPUs", with the measured numbers.
