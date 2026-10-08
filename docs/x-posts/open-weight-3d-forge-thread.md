# X thread: open-weight-3d-forge

A thread for **@trythreews** on how the three.ws Forge runs open-weight text-to-3D and image-to-3D
models in production: the reference picture that comes before the mesh, the lane router, failover
when a GPU worker dies mid-job, cold starts and weight staging, the meshopt decode, and the
per-generation ledger. It is the short companion to the AWS Builder Center article
[aws-builder-center-open-weight-3d-forge.md](../aws-builder-center-open-weight-3d-forge.md), and it
stands on its own for a reader who never opens that article.

**Thesis of this thread:** a 3D model that fails halfway through should not be the user's problem,
and the hard part of running open-weight models is everything around the model. Nothing else. No
token talk, no wallet or payment talk, no roadmap.

Posting is owner-gated per [`CLAUDE.md`](../../CLAUDE.md). This file is copy waiting for a human to
send.

**Every claim below was verified on 2026-10-08**, against the code in this repository, the
production database (read-only queries), the live Cloud Run services, or the live site:

| Claim in the thread | Where it was verified |
|---|---|
| 5,262 generations in the 7 days to 8 October; 147 failed attempts re-dispatched and finished on another lane | `npm run forge:errors` ([`scripts/forge-error-report.mjs`](../../scripts/forge-error-report.mjs)) run 2026-10-08: "generations 5262 done 4889 failed 369", "147 were re-dispatched to another lane and finished there" |
| "Most of them on open-weight models running on our own GPUs" | `forge_creations` grouped by `backend`, same window: about 3,500 of 5,262 rows on `trellis_selfhost`, `hunyuan3d`, `triposg` or `gcp`; the rest are the hosted NVIDIA lane, Hugging Face, and rows with no backend recorded |
| All 147 rescues were self-hosted GPU worker failures, under the same job id | `superseded_by` counts by backend: `trellis_selfhost` 93, `hunyuan3d` 49, `triposg` 5; successor binding in `bindJobSuccessor` ([`api/_lib/forge-failover.js`](../../api/_lib/forge-failover.js)) and the poll handler in [`api/forge.js`](../../api/forge.js); unattended rescues by [`api/cron/forge-finalize.js`](../../api/cron/forge-finalize.js) |
| Reconstruction models read a picture; a text prompt is painted first as one centered subject on a plain background with even light | header of [`api/_lib/forge-reference-image.js`](../../api/_lib/forge-reference-image.js) |
| Six text personas: four on a backdrop slab, two lost the figure; non-Draft TRELLIS jobs are matted first | the `matte: tier.id !== 'draft'` comment in [`api/forge.js`](../../api/forge.js) (measured 2026-09-08) |
| Draft and Standard lead with TRELLIS on an L4; High leads with Hunyuan3D 2.1 on an RTX PRO 6000 Blackwell; hard-surface prompts at High move TRELLIS first | `FREE_DEFAULT_FOR_TIERS`, `classifyForgeSubject`, `freeLaneCandidates` in [`api/_lib/forge-tiers.js`](../../api/_lib/forge-tiers.js); live `default_backend_for_tier` at [three.ws/api/forge?catalog=1](https://three.ws/api/forge?catalog=1); `gcloud run services describe` of `model-trellis` (nvidia-l4, min 1, max 3) and `model-hunyuan3d-21-rtx` (nvidia-rtx-pro-6000, min 1, max 1), which `GCP_HUNYUAN3D_URL` points at |
| Hunyuan3D 2.1 paints colour, roughness and normal maps | [`workers/model-hunyuan3d/README.md`](../../workers/model-hunyuan3d/README.md) ("PBR: baseColor + metallicRoughness + normal") |
| Health tempers the order: healthy or unknown first, else not confirmed down, then the fallback | `defaultBackendForHealthAware` in [`forge-tiers.js`](../../api/_lib/forge-tiers.js) |
| Until August the probe hit the root URL and scored anything under 500 as healthy, including a worker whose model failed to load | comment on `probeSelfHostLane` in [`api/_lib/forge-lane-health.js`](../../api/_lib/forge-lane-health.js) (changed 2026-08-11) |
| Routing reads model readiness separately from process liveness | `ready` / `pipeline_loaded` / `model_loaded` and `load_error` handling in `probeSelfHostLane`; live worker `/health` bodies for TRELLIS, Hunyuan3D 2.1 and TripoSG read 2026-10-08 |
| Poll recovers prompt and reference picture from the row, resubmits, binds old id to new; up to three backups; "running" only once the binding is written | `MAX_FAILOVER_HOPS = 3`, `submitFailoverJob`, `bindJobSuccessor` in [`forge-failover.js`](../../api/_lib/forge-failover.js); `if (bound)` in the poll handler in [`api/forge.js`](../../api/forge.js) |
| TRELLIS worker failed 96 attempts in the week, 93 finished on another engine | `forge_creations` where `backend = 'trellis_selfhost'` and `status = 'failed'`: 96 rows, 93 with `superseded_by` set |
| In July, 410 of 425 TRELLIS failures read "task not found"; a 90-second grace window | header and `GCP_TASK_MISSING_GRACE_MS = 90_000` in [`api/_lib/forge-selfhost-recovery.js`](../../api/_lib/forge-selfhost-recovery.js) (first committed 2026-07-17) |
| Hunyuan3D 2.1 stages about 18 GiB into a RAM-backed /tmp; about 14 GiB loaded on top; the L4 tier's 32 GiB ceiling killed it | "Why an RTX build exists" in [`workers/model-hunyuan3d/README.md`](../../workers/model-hunyuan3d/README.md) |
| RTX PRO 6000 tier starts at 80 GiB; CUDA 12.8; extensions compiled for both GPU generations | same README; `--cpu=20`, `--memory=80Gi` in [`workers/model-hunyuan3d/cloudbuild.hunyuan21rtx.yaml`](../../workers/model-hunyuan3d/cloudbuild.hunyuan21rtx.yaml) |
| Meshopt web copy: 1.25 to 3.34 MB down to 0.11 to 0.67 MB on six samples | comment on `buildWebVariant` in [`api/_lib/forge-store.js`](../../api/_lib/forge-store.js) (sampled 2026-09-04) |
| Most three.ws avatars ship as meshopt; the Python mesh library (trimesh) has no meshopt decoder | header of [`workers/stylize/gltf_meshopt.py`](../../workers/stylize/gltf_meshopt.py) |
| Pinned, checksummed gltfpack; the decoder is copied into five workers | `GLTFPACK_VERSION=v1.2` and `GLTFPACK_SHA256` in the Dockerfiles of `remesh`, `rig`, `segment`, `stylize`, `texture` (5 identical pins) |
| A repo check fails on drift; 27 copies across 36 workers, all identical | `npm run check:vendored` ([`scripts/check-vendored-workers.mjs`](../../scripts/check-vendored-workers.mjs)) on 2026-10-08: "OK: 27 vendored file copies across 36 workers are byte-identical" |
| Every generation is a row from submit, carrying engine, tier, reference model, status, raw error, rescue pointer | `createCreation` in [`forge-store.js`](../../api/_lib/forge-store.js); migrations `20260604000000_forge_creations.sql`, `20260607000000_forge_tier_path.sql`, `20260814200000_forge_failover_supersede.sql` in [`api/_lib/migrations/`](../../api/_lib/migrations/) |
| 95.7% of last week's generations finished, rescued attempts counted as successes | `npm run forge:errors` on 2026-10-08: "success rate 95.7% (recovered attempts are not counted against it)" |
| The Gemini image model on Vertex AI has drawn no reference since 13 August; it sits first in the ladder | `text_to_image_model` in `forge_creations` over 60 days: `vertex-ai/gemini-2.5-flash-image` last on 2026-08-13; `black-forest-labs/flux.1-dev` 22,690 and `pollinations/flux` 3,649 since; ladder order in `seedReferenceImage` ([`api/forge.js`](../../api/forge.js)); live [three.ws/api/forge?health=1](https://three.ws/api/forge?health=1) reports `vertex-gemini` 403 |
| TripoSG's cold-start estimate is 45 seconds; it took about three and a half minutes to load | `coldStartSeconds: 45` on `triposg` in [`forge-tiers.js`](../../api/_lib/forge-tiers.js); live health report at 04:26:36 UTC read TripoSG "down" (4 s probe timeout), the worker's `/health` read `model_loaded: false` from 04:27, `true` at 04:30:14 |
| The last-resort engine returns shape without textures | `ASYNC_REDISPATCH_ORDER` comment in [`forge-failover.js`](../../api/_lib/forge-failover.js); TripoSG `blurb` in [`forge-tiers.js`](../../api/_lib/forge-tiers.js) |
| Draft and Standard are free and need no account | the live page reads "Free · no sign-up"; an unauthenticated `POST /api/forge` with `"tier":"draft"` on 2026-10-08 was accepted at 04:37:13 UTC and done at 04:38:15 on `trellis_selfhost` |
| The workers, router and failover code are open source | [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws), Apache-2.0; every file above is tracked and present on `main` |

**Re-run before posting.** Five numbers describe a week, not the code: 5,262, 147, 96 and 93, and
95.7%. Re-count with `npm run forge:errors` (needs `DATABASE_URL` from `.env.local`) and change the
copy to the new week's numbers, or say "in the seven days to 8 October" exactly as written. The
Gemini claim also moves: if `forge_creations.text_to_image_model` shows `vertex-ai/...` again, cut
post 10's first paragraph.

**Things to NOT claim:**

1. **Do not say the Forge runs on AWS.** It runs on Google Cloud Run in `us-central1`; the AWS link
   is the partner relationship and the article's venue, nothing in the serving path.
2. **Do not say Gemini leads the reference picture today.** It is first in the code and has served
   nothing since 13 August. The older [`forge-article.md`](../../data/x-content/articles/forge-article.md)
   still says it leads; that sentence is stale.
3. **Do not say generation never fails or is 100% reliable.** 222 attempts were lost in the same week.
4. **Do not quote the engine picker's "Standard · usually ~60s".** The ledger's median for Standard
   on the TRELLIS worker is 226 seconds.
5. **Do not say TripoSR or the texture worker serve users.** TripoSR is deployed but receives no user
   jobs (reachable only through the hosted Spaces chain); the texture worker is not deployed.
6. **Do not call all the models open source or commercially licensed.** Say "open-weight". TRELLIS,
   TripoSG and TripoSR are MIT; Hunyuan3D 2.1 ships under Tencent's own license agreement.
7. **Do not quote a GPU quota.** The worker docs disagree on the L4 number.
8. **Do not tag @NVIDIA or @GoogleCloud without owner approval.** Both are true of the stack, but a
   tagged post is approved by a person, never by policy (see [`announce-voice.md`](../announce-voice.md)).

---

## The thread

Eleven posts. Counts use X's weighted rule (any URL, including a bare `three.ws/...`, counts as 23).
The head carries media and no link, which measured better on this account; the link sits once, in
the last post.

**1/** (399 weighted characters)

> In the seven days to 8 October, the three.ws Forge ran 5,262 3D generations, most of them on open-weight models running on our own GPUs.
>
> 147 of those jobs had their GPU worker fail partway through. Each one finished on a different engine under the same job id, and nobody had to click anything.
>
> How a sentence becomes a textured GLB, and what happens when the machine under it dies.

**Media:** `teapot-trellis-draft.png`

**2/** (460 weighted characters)

> The models that build the mesh (TRELLIS, Hunyuan3D 2.1, TripoSG) read a picture, not a sentence. So a text prompt is painted first: one centered subject, plain background, even light.
>
> Plain turned out not to be enough. In a test of six text-prompted characters, four came back standing on a slab of reconstructed backdrop and two lost the figure entirely. Now every non-Draft TRELLIS job gets its background cut out by a separate worker before reconstruction.

**3/** (490 weighted characters)

> Each engine is one entry in a registry, and one function orders them. Draft and Standard lead with TRELLIS on an NVIDIA L4. High leads with Hunyuan3D 2.1 on an RTX PRO 6000 Blackwell, which paints colour, roughness and normal maps. Hard-surface prompts at High swap TRELLIS first.
>
> Health tempers that order, never replaces it: take the first lane that is healthy or unknown, else the first not confirmed down, and only then the fallback. Missing telemetry never demotes a preferred engine.

**Media:** `engine-picker.png`

**4/** (429 weighted characters)

> The health check reads a field, not a port.
>
> Until August our probe hit each worker's root URL and called anything under HTTP 500 healthy. No worker serves its root, so every probe got a 404 and called it fine, including a worker whose model had failed to load.
>
> The workers now report whether the process is up separately from whether the model is loaded, and routing reads the second. A port answering is not a model answering.

**5/** (532 weighted characters)

> The hard failure is the one that happens after a worker has accepted a job. It surfaces minutes later on a status poll, long after the original request is gone.
>
> That poll now recovers the prompt and reference picture from the job's database row, resubmits to the next engine, and binds the old job id to the new one. Up to three backups. It reports "running" only once that binding is written, so a rescue can never turn into an endless poll.
>
> Last week our TRELLIS worker failed 96 attempts. 93 of them finished on another engine.

**6/** (390 weighted characters)

> One failure was not a failure at all. In July, 410 of 425 TRELLIS failures read "task not found": mostly a status poll landing on a different container a few seconds before the job record was visible there.
>
> The fix is a 90-second grace window. Inside it, a missing task means "not visible yet" and the poll keeps waiting. After it, the task really is lost and the backup engine takes over.

**7/** (419 weighted characters)

> Weights taught us about memory. Hunyuan3D 2.1 stages about 18 GiB of weights into /tmp, and on Cloud Run /tmp is RAM. Load the roughly 14 GiB model on top and an L4 instance's 32 GiB ceiling killed the container on every cold start.
>
> The RTX PRO 6000 tier starts at 80 GiB, which clears it. Blackwell needs CUDA 12.8, so the image compiles its GPU code for both card generations, and which GPU runs it is a deploy flag.

**8/** (575 weighted characters)

> We compress the web copy of every large model with meshopt: 1.25 to 3.34 MB down to 0.11 to 0.67 MB on six samples. Most three.ws avatars ship that way too.
>
> Then our own editing workers could not read it, because the Python mesh library they use has no meshopt decoder. Now every worker that loads a caller's mesh decodes it first with a pinned, checksummed gltfpack binary. The decoder is one file copied into five workers, like the rest of our shared worker code, and a repo check fails if any copy drifts. Today: 27 copies across 36 workers, all identical.

**9/** (382 weighted characters)

> Every generation is a database row from the moment it is submitted: prompt, engine, tier, the model that drew the reference picture, status, raw error, and a pointer to the row that rescued it.
>
> That row is how we can say 95.7% of last week's generations finished, with rescued attempts counted as successes rather than failures. It is also how we found the outage in the next post.

**Media:** `teapot-model-info.png`

**10/** (475 weighted characters)

> What it does not do well, said plainly.
>
> The top rung of the picture ladder, a Gemini image model on Vertex AI, has not drawn a single reference since 13 August. The rungs behind it kept every generation going, which is exactly how it went eight weeks without anyone noticing.
>
> Our cold-start estimates are guesses too. The TripoSG worker's says 45 seconds; we watched it take about three and a half minutes to load. And the last-resort engine returns shape without textures.

**11/** (325 weighted characters)

> Draft and Standard are free and need no account. Type a sentence, orbit the result, download the GLB: three.ws/forge
>
> The live health of every engine, including whichever one is cold right now, is public: three.ws/api/forge?health=1
>
> The workers, the router and the failover code are open source: github.com/nirholas/three.ws

---

## Reply to append once the AWS article is live

Hold this until the article in [aws-builder-center-open-weight-3d-forge.md](../aws-builder-center-open-weight-3d-forge.md)
is published on the AWS Builder Center. Whoever publishes it pastes the article's canonical Builder
Center URL, exactly as the Builder Center serves it, at the end of the line below, after the colon
and a space, and posts it as a reply to post 11. With the URL it is 186 weighted characters.

> The full write-up, with the real code for every step in this thread (the router, the failover, the worker deploys, the meshopt fix), is on the AWS Builder Center:

---

## Media plan

Three real screenshots of the live product, captured on 2026-10-08 with Playwright (headless
Chromium, 1440x900 at 2x) against https://three.ws, signed out, and checked by eye: no sign-in wall,
no spinner, no error, no empty state. Each is a crop of the page; nothing was drawn or edited in.
Files are in [`public/x-media/open-weight-3d-forge-thread/`](../../public/x-media/open-weight-3d-forge-thread/).
No paid generation was triggered: the teapot is an existing public Draft, and the one generation run
while writing (a free Draft, to verify the API call in the article) is not pictured.

| Post | File | What it shows | Alt text |
|---|---|---|---|
| 1 | `teapot-trellis-draft.png` | The 3D viewer on the public model page [three.ws/m/d0bf4918-36c5-4716-a476-58b4885e6dc2](https://three.ws/m/d0bf4918-36c5-4716-a476-58b4885e6dc2): a Draft generated by the self-hosted TRELLIS worker from the prompt "a small cast-iron teapot with a bamboo handle". Cropped to the model, which also removes the page's floating companion widget | A textured 3D model of a glossy black cast-iron teapot with a curved yellow bamboo handle, a short spout and a round lid knob, rendered in the three.ws web viewer on a dark background. |
| 3 | `engine-picker.png` | The engine section of [three.ws/forge](https://three.ws/forge): TRELLIS selected, the free lanes (NVIDIA, both Hunyuan3D entries, TRELLIS) and the bring-your-own-key engines, the legend, and the tier line. Cropped to the engine block, so the tier gate and wallet button above and below are out of frame | The engine picker on the three.ws Forge. Engines are listed as chips: NVIDIA, two Hunyuan3D entries and TRELLIS are marked free, the rest carry a key icon for your own API key. TRELLIS is selected. A legend reads free, no API key; your own key; busy; unavailable. Below it: "Standard, Free, usually ~60s, renders a preview image, then builds 3D". |
| 9 | `teapot-model-info.png` | The same model page below the viewer: title, "forged without an account", the action row, Triangles 7.8k and Vertices 5.5k, the "Simulation ready" badge, the prompt, and the tags `item`, `trellis_selfhost`, `draft`, which are the engine and tier columns from the generation's database row | The information panel of a three.ws model page titled "A small cast-iron teapot with a bamboo handle", by an anonymous forger without an account. It lists 7.8k triangles and 5.5k vertices, a green "Simulation ready" badge, buttons for Download GLB, Materialize, Embed and Share, and tags reading item, trellis_selfhost and draft. |

Note on post 3's image: the picker's own copy says "usually ~60s" for Standard, which the ledger does
not support (see "do not claim" item 4). The thread never repeats it; the image is there for the
engine list. If the owner would rather not show that line, crop above it.

Not used: the public page for the High-tier Hunyuan3D generation "an elderly lighthouse keeper"
(`/m/c97f63aa-f15a-4b9f-b845-64ebe023c70f`) rendered as a tiny figure surrounded by scattered
fragments, which reads as broken. It is reported as a finding, not shown.
