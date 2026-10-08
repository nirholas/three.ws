---
venue: NVIDIA Developer Forums
category: AI & Data Science > NVIDIA NIM > Models (where all four approved posts live)
account: nichxbt
suggested_title: "Running a free text-to-3D service on L4s: cold starts, keep-warm crons, and the quota arithmetic behind them"
description: "The fifth three.ws write-up for the NVIDIA developer community: how a free, keyless text-to-3D and avatar service is served from a self-hosted Cloud Run GPU fleet of L4s plus an RTX PRO 6000 Blackwell, how per-lane cold-start budgets shape the product, why min-instances is a quota decision rather than a performance one, and how the NIM free tier fits into a failover chain designed so every rung has a neighbour."
tags: [nim, nemotron, inference]
links_in_body: 2 (our Audio2Face topic and our retirement topic, both on this forum). Repo paths and three.ws are plain text on purpose; see the approval pattern in nvidia-visibility-map.md.
images: 0
status: revised to the approval pattern 2026-09-22 and reframed positively 2026-10-08, owner approval required before posting (external-channel gate in CLAUDE.md)
---

# Running a free text-to-3D service on L4s: cold starts, keep-warm crons, and the quota arithmetic behind them

Hi again, everyone. I run three.ws, an open-source platform where you type a sentence and get a textured, rigged, animated 3D character you can put on any web page. If you are new to it, the simplest way to picture it: a description goes in, and a little later a character that can walk, wave, and talk comes out, with the 3D generation running on NVIDIA GPUs.

I have written here a few times before, most recently about [a browser-tab digital human on Audio2Face-3D](https://forums.developer.nvidia.com/t/a-digital-human-in-a-browser-tab-streaming-audio2face-3d-onto-whatever-rig-the-visitor-brought/383953) and, before that, about [how our fallback chain handles NIM model retirements](https://forums.developer.nvidia.com/t/nvidia-nim-model-retirements-what-a-410-gone-does-to-a-fallback-chain-and-how-we-survive-it-now/383950).

This post is about the half that keeps the free lane free: the GPU fleet. three.ws is a member of NVIDIA Inception, NVIDIA's programme for startups building on accelerated computing, and the views below are our own.

I want to write down the arithmetic, because the arithmetic is where the design lives, and I hope it is useful to anyone serving open models on granted GPU capacity.

## The fleet, in plain terms

Every generation lane runs as its own Cloud Run service on an **NVIDIA L4**, plus one **RTX PRO 6000 Blackwell** for the heaviest work. Every lane speaks one task shape (`POST /<endpoint>` returns a task id, `GET /tasks/:id` returns status and result) and authenticates with one shared bearer secret, so the router can treat every model the same way and swap lanes freely.

The lanes, and what each is for:

- **TRELLIS** (`model-trellis`): native single-hop image to 3D. It accepts a user's photo, and also the view that our text lane synthesizes for a text prompt. Textured GLB out. This is the workhorse lane.
- **Hunyuan3D** (`model-hunyuan3d`): high-poly image-conditioned reconstruction, poly-budget aware, and the default engine for our `high` image tier.
- **TripoSG** (`model-triposg`): sketch to 3D. A drawing plus a prompt naming it, untextured geometry out.
- **TripoSR**, plus the mesh pipeline around all of them: rigging, remeshing, texturing, segmentation, stylization, background removal, garment generation, avatar reconstruction from photos, text to motion, video to motion, video to scene, and sign-language synthesis.

More than thirty workers in total, most of them Docker images you can build and run yourself from `workers/`. Self-hosting gives us a lane we can tune end to end: the same image, the same weights, and the same behaviour every day.

## Cold starts are a model-load question

Container start time on Cloud Run is quick. Where the time goes is the **weight load**, and on a FUSE-mounted weight volume a cold load can take minutes before the first job begins.

So each lane carries an explicit cold-start budget in the router's lane table (`api/_lib/forge-tiers.js`): 45 seconds for TripoSG, 60 for TRELLIS, and 75 for Hunyuan3D, the largest in the fleet. That budget feeds the time estimate a user sees, so a cold lane gets a longer, accurate estimate rather than a guess.

Three consequences shaped the product.

**1. `min-instances` is a quota decision, not a performance one.** Min 1 everywhere would be lovely, but GPU quota on Cloud Run is per accelerator and per region, and it caps concurrent instances rather than services. Our `us-central1` L4 grant is 3, and `us-east4` has a separate grant of 3. In `us-central1`, TRELLIS pins one always-warm instance and bursts to three, the rig lane pins one, and that leaves headroom for TRELLIS to burst when traffic arrives. Hunyuan3D runs at min 0, a change we made on 2026-07-26 after measuring its traffic, which freed a slot for the lanes that needed it. TripoSG scales to zero because its traffic is spiky and its users are happy to wait for a sketch. Three different answers to the same question, each right for its lane.

**2. A keep-warm cron beats a bigger floor.** `api/cron/gpu-keepwarm.js` runs every 10 minutes during peak hours from Cloud Scheduler and holds an allowlist of scale-to-zero lanes resident. It is cheaper than raising a floor because it spends GPU-hours only during the hours people actually generate. Each lane in its registry records its region, its accelerator, and whether warming it is safe by default. Text to motion is warmed by default because it is the only GPU service in `us-east4`, so warming it shares a pool with nothing. The `us-central1` L4 lanes stay out of the default set so the TRELLIS burst headroom stays intact, and they join the moment that grant grows.

The allowlist is an environment variable (`FORGE_KEEPWARM_LANES`), so it changes without a deploy. Two details worth borrowing: **a lane id that matches no known lane is reported as `unknown_lanes` and marks the tick as failed**, so a config typo surfaces at the very next tick, and a test (`tests/cron-forge-lane-guards.test.js`) pins the keep-warm registry against the router's lane table, so every scale-to-zero lane with a cold-start budget is always reachable by the override.

**3. Show real progress during a cold start.** When a lane is cold, the user is told what is actually happening (the model is loading) with an estimate built from that lane's budget. Our text-to-3D path goes through an intermediate image, so we can also show the concept art the geometry model is about to sculpt. Showing something true and specific makes the wait feel shorter.

## The GPU pool as a first-class signal

We treat the state of the regional L4 pool as a signal in its own right. Our triage runbook has a named signature for a saturated pool, and the first check on any "generation is slow" report is the pool, then the model.

The operational rule I would give anyone building on a granted GPU pool: **file the quota increase the moment you reach the ceiling, and route around it in the same hour.** Lower a min-instance somewhere else, use the other region's grant, or queue behind existing capacity. That keeps the product moving at full speed while the request is reviewed.

The second region is a big part of that. `us-east4` carries production text to motion plus standbys of TRELLIS, Hunyuan3D, and TripoSR, so a busy hour in one region has somewhere to go.

## Failover per lane, with every rung backed by another

Every generation lane has a failover chain, so when one model is busy the request moves to the next lane and still completes. The same discipline runs on the text side, and that chain is where NIM sits.

The text chain tries free rungs first, in order, and reaches a paid key only at the very end. NVIDIA NIM is one of those free rungs, on the free developer tier, pinned to `nvidia/nemotron-3-super-120b-a12b`, with `nvidia/nemotron-3-ultra-550b-a55b` and `nvidia/nemotron-3.5-lightning-30b-a3b` alongside it. Three design rules make it work:

**Audit pinned model ids on a schedule.** `api/cron/free-model-audit.js` runs every six hours and checks every hardcoded model id against the live catalogues, NIM's Nemotron pins included. Because a catalogue listing and an account's callable set can differ, an id is only reported as gone after a live one-token call confirms it, and the ops channel hears about it before any user does. That is the practical result of the retirement post linked above.

**Send reasoning models the right flag.** The Nemotron rungs are a reasoning family, so the chain sends `chat_template_kwargs: { enable_thinking: false }` to keep the answer in `content`, where the caller reads it. Normalising each provider's conventions is what lets every rung contribute a real answer.

**Keyless rungs at the bottom.** Two rungs in the chain need no key at all, so the chain always has somewhere to land, whatever keys are configured.

The same NIM account serves more than chat: `meta/llama-3.2-11b-vision-instruct` for vision, `nvidia/nemotron-3-embed-1b` for embeddings, NemoGuard and Llama Guard for publishing safety, Magpie TTS over Riva gRPC for speech, and FLUX and TRELLIS through GenAI invoke. The full model-by-model map is in `docs/nvidia-models.md`.

## How free and keyless stays sustainable

The free 3D lane needs no account and no key. Three choices keep it sustainable:

1. **Scale to zero where the traffic is spiky**, and keep standing GPU-hours only where a warm instance makes a visible difference.
2. **Self-host the lanes we can**, so each generation costs only its own compute.
3. **Check before you generate.** Two of our free endpoints exist to save GPU work: a physics-readiness grade that tells a caller whether an asset is usable as a rigid body before they build on it, and a vision tool that lets an agent look at what it generated, as rendered frames, and decide whether to iterate. A free check gets run on every asset, and a caller who can evaluate a result iterates deliberately instead of regenerating from scratch.

## The programmes behind the fleet

three.ws takes part in eight partner programmes, and two of them sit directly under this post:

- **NVIDIA Inception.** We are a member (accepted July 2026). Every 3D generation lane runs on NVIDIA silicon: text to 3D, photo to avatar, auto-rigging, and motion, plus the hosted NIM lane behind chat, vision, embeddings, safety, and speech. Membership is how we plan to scale past free-tier limits while keeping the free-first design.
- **Google Cloud.** three.ws is a member of Google Cloud for Web3 Startups, which backs our compute and Vertex AI usage. The whole fleet above runs on Cloud Run GPU services, and the Vertex Gemini rung anchors the text chain from our own cloud budget.

The other six programmes are OpenAI (Select Partner), IBM (Business Partner), Alibaba Cloud, AWS, HackerNoon (media), and Quicknode (infrastructure). Each is a programme designation, and nothing here is a statement by any of those companies.

## Try it, and check the claims

Free, keyless, no account:

```bash
# text to a textured GLB
curl -s -X POST https://three.ws/api/3d/studio \
  -H 'content-type: application/json' \
  -d '{"prompt":"a small ceramic robot figurine"}'

# is the result usable as a rigid body?
curl "https://three.ws/api/sim-readiness?src=<glb url>"
```

The workers (workers/), the routing and cold-start budgets (api/_lib/forge-tiers.js), the keep-warm cron (api/cron/gpu-keepwarm.js), the model audit (api/cron/free-model-audit.js), and the failover chains (api/_lib/llm.js) are all in the open repository, nirholas/three.ws on GitHub, and `GET https://three.ws/api/version` returns the exact commit production is running, so anything above can be checked against the code that serves it.

If you run generation lanes on granted GPU capacity, I would love to compare notes on two things: how you decide which lanes earn a warm floor, and what has worked best for you on cold weight loads. And for the NVIDIA folks reading: we would be glad to hear whether a weight-streaming pattern or a recommended NIM container layout fits Cloud Run's FUSE-mounted volumes best.
