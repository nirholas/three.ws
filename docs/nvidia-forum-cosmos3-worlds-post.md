---
venue: NVIDIA Developer Forums
category: AI & Data Science > Generative AI (Cosmos world foundation models)
account: nichxbt
suggested_title: "Moving a world-generation lane from hosted Cosmos Predict1 to a self-hosted Cosmos 3 Nano, conditioned on a 3D avatar's own scene"
description: "Our hosted Cosmos Predict1 routes started answering 404 for our account, so the /cosmos lane went dark. We moved it to nvidia/Cosmos3-Nano on one Cloud Run RTX PRO 6000, added image, depth and edge conditioning captured from a three.js render of the avatar, and made jobs durable with real step progress. Measured times, the model ladder, and what we would ask for."
tags: [cosmos, world-foundation-models, diffusers]
links_in_body: 0. three.ws and repo paths are plain text on purpose.
images: 2 to 3 mid-clip frames from docs/nvidia/evals/cosmos/2026-11-16/ (owner picks)
status: draft
---

# Moving a world-generation lane from hosted Cosmos Predict1 to a self-hosted Cosmos 3 Nano, conditioned on a 3D avatar's own scene

three.ws is an open-source platform for 3D avatars that run in a browser. We are a member of the NVIDIA Inception program. One of our pages, /cosmos, puts an avatar in front of a short generated video world: you type "a neon Tokyo street in the rain at night", a Cosmos world model renders five seconds of it, and the page plays the clip as a full-bleed backdrop behind the transparent avatar.

This post covers what happened when the hosted model under that page stopped answering, what we moved to, and the one feature the move made possible: worlds conditioned on the avatar's own scene instead of on text alone. Cosmos 3 Nano is under evaluation on our side; the worker is live, and the production API switch is the last step.

## The hosted routes went quiet

The lane used the hosted Cosmos Predict1 Text2World functions (7B first, 5B behind it). On 2026-10-21 every request started failing. A rung-by-rung probe on 2026-11-16 gave:

| Route | Answer |
|---|---|
| cosmos-predict1-7b | 404 "Not found for account" |
| cosmos-predict1-5b | 404 "Not found for account" |
| cosmos-transfer1 | 410 |
| predict2, predict2.5, transfer2.5 | 404 |

A 404 that names the account reads like a permissions problem, not a retirement, so we kept both Predict1 rungs in our model ladder behind the new top rung. If they come back for our account, the ladder uses them again without a code change.

## The new top rung: Cosmos 3 Nano on one GPU

We now run nvidia/Cosmos3-Nano through diffusers on a Cloud Run service with one RTX PRO 6000 Blackwell, scaled to zero between worlds. One checkpoint serves four modes:

- **text**: text to world.
- **image**: a still of the avatar's scene becomes frame 0 and the world grows out of it.
- **depth**: a three.js depth pass of the avatar on a slow 4-second orbit steers the layout.
- **edge**: a lit render of the same orbit, which the worker turns into Canny edges, steers the outlines.

We sample with the published defaults: 35 steps at 24 fps for text and image, and 50 steps at 30 fps with control guidance for depth and edge. Before sampling, a Nemotron model from the API Catalog expands the user's sentence into the structured JSON caption Cosmos 3 was trained on. If that call fails, the worker samples on the plain prompt and records `upsampler: "none"` on the job, so a run never pretends it was upsampled.

## Measured, not estimated

All numbers come from real runs on 2026-11-16 at 720p and 121 frames.

- **Warm text world:** 244.1 s worker total. That splits into 10.8 s prompt upsampling, 231.1 s sampling (about 6.6 s per step) and 1.8 s encode. The output is 1280x720 H.264, 121 frames, about 1.5 MB.
- **Five-prompt warm run:** median 245.7 s from submit to a playable URL, with sampling flat between 228.5 and 230.2 s.
- **Scene-conditioned worlds:** a still-conditioned world took 4m 05s. A depth-conditioned world took 17m 44s: 50 control-guided steps at about 21 s each, roughly 4.3x a text world.
- **Cold start:** 1041.5 s (17.4 minutes) to load the 34.9 GB checkpoint over a gcsfuse mount: transformer, VAE, Qwen3-VL vision encoder, sound tokenizer and text tokenizer. Cold start is the cost of scaling to zero, and it is the number we most want to bring down.
- **Old versus new, five prompts:** the hosted Predict1 routes refused every submit before generation, so there is no old clip or old time to compare. The side-by-side table, with per-prompt sampling times and mid-clip frames, is in docs/nvidia/evals/cosmos-2026-11-16.md in the repo.

## Conditioning on the avatar's scene

The capture runs entirely in the browser. The page renders the avatar with the same camera orbit and field of view as the on-page viewer, at the output geometry (1280x720 for 720p, 832x480 for 480p):

- **Image mode** takes one frame of the avatar over its current backdrop and sends it as a JPEG.
- **Depth and edge modes** record the orbit with MediaRecorder as WebM. For depth, a MeshDepthMaterial override draws near surfaces bright, so Cosmos sees the silhouette and the camera move.

The result is a world that keeps the avatar's framing and motion, instead of a stock clip pasted behind it.

One small integration detail cost us a day. Browsers report the recording type with codec parameters (`video/webm;codecs=vp9`), and a strict MIME check on the API refused every depth capture. We now accept and normalize the parameterized type.

## Jobs that survive reloads and restarts

A world takes minutes, so the job has to outlive the tab:

- The worker writes every state change to a private GCS bucket, so a task id stays valid across API instances and worker restarts.
- The page stores the active job and resumes it after a reload. We tested this by reloading mid-generation, and the page picked the job up at the same step.
- Progress comes from the worker's real state (queued, upsampling, step x of 35 with an ETA, decoding, encoding), never from a timer.
- When a job finishes, the API copies the clip once to our CDN at a key derived from the job id, so every later poll returns the same URL.

## What we would ask for

1. **Lifecycle signals on hosted Cosmos functions.** A 404 "Not found for account" does not say whether a function was retired, moved, or entitlement-gated. A 410 with a date, or a deprecation header ahead of time, would let a ladder step past a dead route with confidence.
2. **Faster cold loads for the Cosmos 3 checkpoint.** A pre-sharded or safetensors-streaming layout tuned for network filesystems would help anyone running it scale-to-zero. Most of our 17 minutes is reading weights, not compute.
3. **A small hosted Cosmos 3 endpoint**, even rate-limited, for teams who want to try image and depth conditioning before standing up a GPU.

The worker, the ladder, the capture code, and the eval script are all in the three.ws repository: workers/model-cosmos, api/_lib/cosmos-ladder.js, src/cosmos-scene-capture.js, and scripts/nvidia-cosmos-eval.mjs.
