# Cosmos: living worlds behind your 3D avatar

Cosmos turns a sentence, or the avatar's own scene, into a living, photoreal world that plays behind your 3D avatar. You pick an avatar, describe a place, and an NVIDIA Cosmos world model renders a short cinematic video of it; the page composites that clip as a full-bleed backdrop behind the transparent avatar, so the character appears to stand inside a moving scene. Preview it live, download the MP4, or share a link that opens on the finished world.

Page: [/cosmos](https://three.ws/cosmos) · API: `/api/cosmos` · Worker: [workers/model-cosmos](../workers/model-cosmos/README.md)

## Why it exists

A 3D avatar on a flat gradient is a portrait. A 3D avatar standing in a neon Tokyo street in the rain is a scene. Cosmos gives every avatar a world to inhabit without a render farm, a game engine, or a video editor. Scene mode goes further: the world is built from the avatar's own framing, pose and silhouette, so the backdrop matches the character instead of being a stock clip behind it.

## Two ways to build a world

The mode picker above the prompt has two choices.

- **Text.** Describe the place in up to 600 characters. Cosmos renders it from scratch (text-to-world).
- **From my scene.** The page captures the avatar as it stands on the stage and the world is conditioned on it. Three kinds:
  - **Still** (image-to-world): a snapshot of the avatar over its current backdrop becomes the first frame, and the world grows out of it.
  - **Depth** (layout transfer): a three.js depth pass of the avatar slowly orbiting (4 seconds, near = bright) steers the world's geometry, so the generated scene keeps the avatar's shape and camera move.
  - **Edge** (layout transfer): a lit three.js render of the same orbit, which the worker turns into Canny edges, steers the world's outlines.

Captures run in the browser with the same camera orbit and field of view as the on-page viewer, at the output geometry (1280x720 for 720p, 832x480 for 480p). The scene card shows a thumbnail of the capture, its size, and a Recapture button; changing the avatar, the kind, or the resolution marks the capture stale and the next Generate takes a fresh one.

## How it works

`/api/cosmos` walks a model ladder ([api/_lib/cosmos-ladder.js](../api/_lib/cosmos-ladder.js)). Each rung owns its request builder, its limits, and the modes it can render, so a request only reaches a rung that can honor it.

| Rung | Where it runs | Modes | Limits |
|---|---|---|---|
| `cosmos3-nano` (Cosmos 3 Nano) | self-hosted worker on a Cloud Run RTX PRO 6000 ([workers/model-cosmos](../workers/model-cosmos/README.md)) | text, image, depth, edge | 600-character prompts, 480p or 720p, 33 to 121 frames |
| `cosmos-predict1-7b` | hosted NVIDIA NVCF Text2World | text | 300-character prompts, 1280x704, 121 frames |
| `cosmos-predict1-5b` | hosted NVIDIA NVCF Text2World | text | same as 7B |

Rungs are tried in order. A rung that is not configured, or cannot render the mode, is skipped; a rung that reports itself gone or unreachable is stepped past. A busy worker, a bad key, or invalid input stops the walk instead, because an older model would not fix them and a busy GPU should tell the user to wait rather than silently swap in a weaker model. As of 2026-11-16 the hosted predict1 routes answer 404 "Not found for account" (see the [eval](./nvidia/evals/cosmos-2026-11-16.md)), so in practice every world renders on Cosmos 3 Nano; the hosted rungs stay in the ladder for as long as NVIDIA keeps the gateway paths up.

The worker loads [nvidia/Cosmos3-Nano](https://huggingface.co/nvidia/Cosmos3-Nano) through diffusers and samples with NVIDIA's published defaults: 35 steps at 24 fps for text and still, 50 steps at 30 fps with control guidance for depth and edge. Before sampling it expands the prompt into the structured JSON caption Cosmos 3 was trained on with a Nemotron model from the NVIDIA API Catalog, and falls back to the plain prompt (recorded as `upsampler: "none"`) if that call fails.

### Jobs

A submit answers `202 { job_id }`. The job id names its rung (`cw_` for the worker, `nv_` and `n5_` for the hosted routes), and every rung keeps its own durable job record (the worker writes each state change to GCS), so a poll needs only the id. The page stores the active job in `localStorage` and resumes it after a reload, a closed tab, or an API redeploy. When the worker reports `done`, the API copies the clip once to R2 at `forge/cosmos/<job_id>.mp4` and every later poll gets that CDN URL.

The page polls with backoff: first after 2.5 seconds, then 1.35x per poll up to 15 seconds, held at 6 seconds while frames render so the step counter stays live, and a 429 waits the full interval. A job is abandoned after 40 minutes. Twelve consecutive network failures stop polling but keep the job saved, so reopening the page picks it up again.

### Progress

The progress bar reads the worker's real state, never a timer:

| Worker status | What the page shows |
|---|---|
| `queued` with `model loading` | Warming the GPU (the first world after an idle period pays a checkpoint load, measured at 17 minutes on 2026-11-16) |
| `queued` | the queue position |
| `upsampling` | Writing the shot (prompt upsampling) |
| `generating` | step x of y and the worker's ETA |
| `decoding`, `encoding` | Decoding frames, Encoding the clip |

Five phase pills (Capture, Queue, Shot, Frames, Encode) mark where the job is. On completion the result chip shows the model and the measured timings (shot, control decode, sampling, encode, total).

## Walkthrough

1. Open [/cosmos](https://three.ws/cosmos). The badge names the model that will render (Cosmos 3 Nano when the worker is configured).
2. Pick an avatar from the bundled set, or load your own GLB.
3. Choose **Text**, or **From my scene** and a kind (Still, Depth, Edge). In scene mode, frame the avatar on the stage first; Capture takes the still or records the 4-second orbit.
4. Describe the world, for example `a neon Tokyo street in the rain at night`.
5. Optionally open Advanced to set a seed, the resolution (720p or 480p), and the length (about 5, 2.5 or 1.5 seconds).
6. Click Generate and watch the real progress. You can leave; the job resumes when you come back.
7. When the world lands it plays behind your avatar. Scene worlds already contain the avatar, so the overlay is hidden; the layers button brings it back. Regenerate, download (`cosmos-<mode>-<prompt>.mp4`), or Share a link that carries the clip, avatar, prompt, seed and mode.

## Examples

```bash
# Text world: start the job, then poll it.
JOB=$(curl -s -X POST 'https://three.ws/api/cosmos' \
  -H 'content-type: application/json' \
  -d '{"mode":"text","prompt":"a neon Tokyo street in the rain at night","resolution":"720"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("job_id",""))')

curl "https://three.ws/api/cosmos?job=$JOB"

# Which rungs and modes this deployment can serve right now.
curl https://three.ws/api/cosmos
```

Scene worlds send the capture as a data URL: `"image": "data:image/jpeg;base64,..."` for `mode: "image"`, or `"control_video": "data:video/webm;base64,..."` for `depth` and `edge` (a browser MediaRecorder type with codec parameters such as `video/webm;codecs=vp9` is accepted). The request body may be up to 30 MB.

```javascript
const start = await fetch('https://three.ws/api/cosmos', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ mode: 'image', prompt: 'a bioluminescent forest at midnight', image: stillDataUrl }),
}).then((r) => r.json());

let job = start;
while (job.status !== 'done' && job.status !== 'failed') {
  await new Promise((r) => setTimeout(r, 6000));
  job = await fetch(`https://three.ws/api/cosmos?job=${start.job_id}`).then((r) => r.json());
  console.log(job.status, job.step, job.total_steps, job.eta_seconds);
}
console.log(job.video_url ?? job.error);
```

## States and limits

- **Offline (503, `lane_unavailable`)**: no rung can serve the mode (the worker is not configured and the hosted routes are retired). The avatar keeps its aurora backdrop, the badge reads offline, and modes no rung renders are disabled with a tooltip. No mock clip is ever shown.
- **Busy (429, `lane_busy`)**: the worker queue (4 worlds) is full. Try again in a few minutes.
- **Invalid input (400)**: prompt length, seed, resolution, frame count, or a capture the worker cannot decode, with a sentence saying which.
- **Job failures** carry a code and a recovery hint: `worker_restarted` (start again, settings are kept), `timeout` and `gpu_oom` (try 480p or fewer frames), `bad_image` and `bad_control_video` (capture again), `expired`, `generation_failed`.
- **Rate limits**: 8 worlds per hour per IP, 90 per hour across the deployment.
- **Empty scene**: scene mode with no capture yet tells you to frame the avatar and press Capture, and Generate captures for you if you skip it.
- **Unplayable clip**: a URL that will not decode drops the stage out of its finished state and offers a retry.
- Upstream details (which can carry an NVIDIA account id) are logged server-side, never returned.

## Operating it

- The API needs `COSMOS_WORKER_URL` and `COSMOS_WORKER_KEY` for the top rung and `NVIDIA_API_KEY` for the hosted rungs. `NVIDIA_COSMOS_INVOKE_URL` pins the hosted rungs to one endpoint.
- The worker scales to zero between worlds. Raise `_MIN_INSTANCES` in [workers/model-cosmos/cloudbuild.yaml](../workers/model-cosmos/cloudbuild.yaml) if the lane needs instant starts.
- `node scripts/verify-nvidia-cosmos.mjs` probes every rung and renders one world end to end on the first live one. `node scripts/nvidia-cosmos-eval.mjs` reruns the five-prompt comparison in [docs/nvidia/evals](./nvidia/evals/cosmos-2026-11-16.md).

## Related

- [Forge](./forge.md) makes the 3D avatars and objects you place in a Cosmos world.
- [Avatar creation](./avatar-creation.md) and [the trait-based avatar builder](./character-studio.md) for building and dressing avatars.
- Pages: [/create](https://three.ws/create), [/gallery](https://three.ws/gallery), [/scene](https://three.ws/scene).
