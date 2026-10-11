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
published models with on-chain creator royalties, and `embody`, which returns
a rigged, talking avatar plus a one-tag web embed for an agent.

Generation and pipeline calls are asynchronous. The paid response carries a
job token; poll `GET /api/forge?job=<token>` (free, no payment) until
`status` is `done` and read the GLB URL from the result. Draft-tier prompts
often finish inline and return the GLB URL directly.

Every output is a durable HTTPS URL to a binary glTF (GLB) that loads in
Three.js, Babylon.js, Unity, Unreal, Blender, and `<model-viewer>`.

## Spend-aware usage

- Generate at the `draft` tier while iterating on a prompt, then rerun the
  winner at `standard` or `high`.
- Chain stages in one `/api/x402/pipeline` call instead of paying for each
  stage separately; the 402 quotes the exact sum of the stages requested.
- Run `/api/x402/model-check` on a third-party GLB before paying to rig or
  remesh it; it reports triangle counts, materials, and problems first.
- Polling a job is free. Never resubmit a paid generation to check progress.
- Browse remix sources with the free `GET /api/remix-feed` before paying for a
  remix, and reuse the returned creation ids.
