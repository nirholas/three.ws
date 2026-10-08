---
venue: Google Cloud Community (Medium publication) / Google Cloud Community forums
account: three.ws (official)
suggested_title: "One container, 125 scheduled jobs, and a GPU fleet that sleeps: an AI platform on Cloud Run"
description: "How three.ws serves a static frontend, a route table, every API handler, and a fleet of open 3D model GPUs from Cloud Run: the single-container decision, Cloud Scheduler as the cron plane, per-lane GPU floors and a keep-warm cron, Vertex AI as the reliability anchor in a free-first model chain, and the deploy gates that check every release before it ships."
tags: [cloud-run, cloud-scheduler, vertex-ai, gpu, generative-ai]
status: draft, owner approval required before posting (external-channel gate in CLAUDE.md)
---

# One container, 125 scheduled jobs, and a GPU fleet that sleeps

Hello, Google Cloud community! three.ws is an open-source platform where you describe a character in a sentence and get a rigged, animated 3D agent you can embed on any web page. It can talk, it can listen, and it runs entirely on Google Cloud. three.ws is a member of Google Cloud for Web3 Startups, which backs our compute and Vertex AI usage.

If you are new to the platform, picture three things running together: a website, an API with more than a thousand handlers, and a fleet of GPU workers that turn text and photos into 3D models. This post is the infrastructure write-up for all three: what runs where, the decisions we are happiest with, and the deploy gates that check every release before it reaches a user.

Everything is Apache-2.0 at [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws), and `GET https://three.ws/api/version` returns the exact commit and Cloud Run revision production is serving, so any claim here can be checked against the code that serves it.

## The architecture at a glance

| Layer | Google Cloud service | What it does for us |
|---|---|---|
| Edge | Global External Application Load Balancer with Cloud CDN | TLS, the domain, and cached static assets close to users |
| App | One Cloud Run service (`three-ws-api`, `us-central1`) | The frontend, the route table, and every API handler |
| Jobs | Cloud Scheduler | 125 scheduled jobs, declared in the repo |
| GPUs | Cloud Run GPU services (NVIDIA L4, plus one RTX PRO 6000 Blackwell) | Open 3D model lanes, each its own service |
| Models | Vertex AI | Gemini as the reliability anchor of the text chain, Imagen leading the image ladder |
| Builds | Cloud Build | One gated pipeline from commit to revision |

## The single-container decision

One Cloud Run service serves three things that are often three deployments: the **static frontend**, the **route table**, and **every API handler**.

The route table is the part worth explaining. Our routes live in a JSON config that the server reads on boot and splits at a filesystem marker into pre-filesystem and post-filesystem phases. A route change is therefore a config change rather than a code change, and the same file is the source of truth for the scheduler sync described below. There is exactly one place to answer "what serves this path?", and it has paid for itself many times over.

Why one container rather than a service per concern:

- **A page and the API it calls share a deploy**, so a frontend and the field it expects always ship together.
- **One service to keep warm.** Every user path lands on the same warm instances.
- **The revision is the unit of truth.** "Which revision is serving this?" has one answer, and a rollback is one `gcloud run services update-traffic` command pointing 100% at a known-good revision.
- **The server imports each handler on first hit**, so a large API surface keeps its startup lean.

For a product where the frontend and the API evolve together in almost every commit, it is a great fit.

## Cloud Scheduler as the cron plane

There are 125 scheduled jobs. They are declared in the same config file the server reads for routes, and a script syncs that declaration into Cloud Scheduler, so adding a job is a config change reviewed like any other.

Two practices make that number easy to run:

**A dispatcher for the high-frequency work.** Several of our most frequent jobs are invoked by one economy tick that fans out, with per-entry cooldowns deciding what actually fires. One tick on one warm instance handles the minute.

**Declare the schedule where the code lives.** A cron defined in the repo shows up in code review and in `git log`, and the whole schedule can be recreated from a clean checkout with one sync.

A few of the jobs that run on that plane: a GPU keep-warm tick, a six-hourly audit of every pinned model id against live provider catalogues, and a changelog publisher that posts each new release note to the community automatically after the deploy that ships it.

## The GPU fleet, and why min-instances is a quota decision

The generation lanes run open 3D model families on their own Cloud Run GPU services: TRELLIS for image to 3D, Hunyuan3D for high-poly reconstruction, TripoSG for sketch to 3D, and around them the mesh pipeline (rigging, remeshing, texturing, segmentation, stylization, background removal, avatar reconstruction, text to motion, video to motion, video to scene). More than thirty workers in total, most published as Docker images, all speaking one task shape and one shared bearer secret, so the router can treat every lane alike.

The interesting cost is the **weight load**, since a FUSE-mounted weight volume can take minutes to load cold. Each lane carries an explicit cold-start budget in the router (45 seconds for TripoSG, 60 for TRELLIS, 75 for Hunyuan3D), and that budget feeds the estimate a user sees. That leads to a counter-intuitive rule:

**`min-instances` is a quota decision, not a performance one.** Cloud Run GPU quota is per accelerator and per region, and it caps concurrent instances. Our `us-central1` L4 grant is 3, with a separate grant of 3 in `us-east4`. TRELLIS pins one always-warm instance and bursts to three, the rig lane pins one, Hunyuan3D runs at zero to keep burst headroom free, and the spiky sketch lane scales to zero. Different answers to the same question, each right for its lane.

A keep-warm job runs every 10 minutes during peak hours and holds an allowlist of scale-to-zero lanes resident, spending GPU-hours only when people actually generate. The allowlist lives in an environment variable, so it changes without a deploy. Two details worth copying: **a lane id in that allowlist that matches no known lane is reported and fails the tick**, so a typo surfaces immediately, and a test pins the keep-warm registry against the router's lane table, so every scale-to-zero lane stays reachable.

The two regions work as a pair. `us-east4` runs production text to motion plus standbys of the main 3D lanes, which gives a busy hour in `us-central1` somewhere to go. Our triage runbook also has a named signature for a saturated regional pool, so the first check on any "generation is slow" report is the pool. The operating rule: file the quota increase the moment you reach the ceiling, and route around it the same hour.

## Vertex AI as the anchor of a free-first chain

Every text completion on the platform runs through one shared failover chain that tries free providers first and reaches a paid key last. That chain is a dozen rungs deep, and two design rules matter more than the ordering:

**Every rung has a neighbour, and the bottom is keyless.** Two rungs need no key at all, so the chain always has somewhere to land, whatever keys are configured.

**Vertex Gemini is the reliability anchor.** When `GOOGLE_CLOUD_PROJECT` is set (every Cloud Run deploy), Gemini Flash-Lite on Vertex sits between the free tiers and the paid tail, authenticated by the service account and billed to our own cloud budget. Its capacity is ours to plan, which is exactly why a first-party cloud model belongs in a free-first chain: it is the rung whose behaviour we fully control.

Vertex also leads our text-to-image ladder: when the project is set, Vertex Imagen goes first for photoreal reference images, which then become the input to the 3D lanes.

Pinned model ids get a scheduled audit too. Every six hours a job diffs our hardcoded model ids against the live provider catalogues and confirms with a live one-token call before flagging anything, so the team learns about a catalogue change well before a user would.

## Deploy gates that check every release

Our build is one command, `npm run build:gcp`, and its order is deliberate: conflict check, browser-graph check, a temporal-dead-zone check for Safari, sub-artifact builds, the frontend build, then the steps that write into the output directory *after* the frontend build refreshes it. Encoding that order in one command means every engineer and every agent builds the same way.

Then `npm run deploy:gcp:submit` runs the gates, each checking one property mechanically before Cloud Build sees the code:

**1. Schema first.** The submit stops while any database migration is pending, so new code always meets the schema it expects.

**2. An upload-context simulation.** We simulate the build-context upload and confirm every file the server imports at runtime is included, so the container that starts has every module it needs.

**3. The lockfile matches the install.** The image installs from `package-lock.json`, and the gate confirms the local `node_modules` matches it, so the code we test is the code we ship.

**4. Every API module imports cleanly.** A check imports every module under `api/` and confirms each one loads, because the server imports a handler on first request.

**5. A synchronous CDN purge.** After the deploy, the purge runs synchronously. It takes about three seconds and means every post-deploy check reads fresh edge content.

**6. A smoke sweep.** After the purge, a smoke test visits every page declared in our page registry against the live site.

And the cheapest tool of all: the version endpoint that returns the running commit and revision. "Is this live?" is one curl.

## Partners across the stack

three.ws takes part in eight partner programmes, and several of them sit right inside this architecture:

- **Google Cloud.** three.ws is a member of Google Cloud for Web3 Startups. Cloud Run, Cloud Scheduler, Cloud Build, Cloud CDN, and Vertex AI carry the whole platform, and the programme backs that compute and Vertex AI usage.
- **NVIDIA Inception.** three.ws is an NVIDIA Inception member. Every GPU lane in this post runs on NVIDIA L4s or the RTX PRO 6000 Blackwell on Cloud Run, and NVIDIA-hosted models are among the free rungs of the text chain.
- **Quicknode (Infrastructure).** three.ws is in the Quicknode Startup Program, and Quicknode is a rung in our Solana RPC failover chain, the same rung-and-neighbour design as the model chain above.
- **OpenAI (Select Partner).** The keyless 3D Studio connector that brings our 3D tools into ChatGPT is served from this same Cloud Run container.
- **Alibaba Cloud.** Qwen models are first-class lanes in our model router, and three.ws is live on the Alibaba Cloud International Marketplace.
- **IBM (Business Partner), AWS (Partner), and HackerNoon (Media)** complete the eight.

These are programme designations, and the views here are our own. The full map is at [three.ws/partners](https://three.ws/partners).

## What I would tell someone starting the same build

- **Put the route table in a file the server reads,** and let other tooling read the same file. One source of truth beats one convention.
- **Decide per lane whether a warm floor is worth it,** and write down why next to the config.
- **Give every failover chain a keyless foundation and a first-party anchor.**
- **Encode every deploy property as a gate the build runs.** A gate turns knowledge into something every release checks automatically.
- **Publish the version.** It takes an afternoon and answers "what is live?" forever.

Free to try, no account and no key: [three.ws/forge](https://three.ws/forge) for 3D generation, `https://three.ws/api/mcp-studio` for the fourteen-tool MCP server, and [three.ws/docs](https://three.ws/docs) for the rest.
