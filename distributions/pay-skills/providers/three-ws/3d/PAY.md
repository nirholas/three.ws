---
name: 3d
title: "three.ws 3D"
description: "Text-to-3D and image-to-3D generation returning GLB models, plus a 3D asset pipeline: auto-rigging, remeshing, game-ready retopology, geometric stylizing, background removal, model inspection, remixing, and talking avatar bodies."
use_case: "Use when an agent needs a 3D model, game asset, prop, or character: generate a GLB from a prompt or photos, rig a static mesh for animation, cut a mesh to a poly budget, restyle it, check a GLB before using it, or give an AI agent a 3D avatar body."
category: media
service_url: https://three.ws
openapi:
  path: openapi.json
---

three.ws is a 3D platform for AI agents. This provider covers the paid 3D
endpoints: generation (text or up to six photos in, textured GLB out), the
asset pipeline that turns any public GLB into a rigged, retopologized, or
restyled one, structural inspection of a GLB before you use it, remixes of
published models with on-chain creator royalties, `embody`, which returns a
rigged, talking avatar plus a one-tag web embed for an agent, and
`mint-to-mesh`, which renders a Solana token mint as a themed GLB.

`/api/x402/forge` and `/api/x402/pipeline` are asynchronous. The paid response
carries a job token; poll `GET /api/forge?job=<token>` (free, no payment) until
`status` is `done`, then read `glb_url` (generation) or `result_glb_url`
(pipeline). Draft-tier prompts often finish inline and return `glb_url`
directly. The single-stage `pipeline-*` endpoints, `remix-asset`, and `embody`
wait for the result and return it in the paid response.

Output formats differ by endpoint:

- Generation, pipeline, rig, remesh, gameready, stylize, remix, and embody
  return a durable HTTPS URL to a binary glTF (GLB).
- `pipeline-rembg` returns a URL to a transparent PNG.
- `model-check` returns a JSON report and no model file.
- `mint-to-mesh` and `mint-to-mesh-batch` return the GLB bytes base64-encoded
  inside the JSON response instead of a URL.

## Spend-aware usage

- Generate at the `draft` tier while iterating on a prompt, then rerun the
  winner at `standard` or `high`.
- `/api/x402/pipeline` trades price for convenience: one payment and one job
  for the whole chain, but its rig, remesh, gameready, and stylize stages cost
  more than the matching single-stage endpoints. Call those endpoints directly
  when cost matters. `GET /api/x402/pipeline` (free) lists the live per-stage
  prices.
- Run `/api/x402/model-check` on a third-party GLB before paying to rig or
  remesh it; it reports triangle counts, materials, and optimization tips first.
- Polling a job is free. Never resubmit a paid generation to check progress.
- Browse remix sources with the free `GET /api/remix-feed` before paying for a
  remix, and reuse the returned creation ids.
