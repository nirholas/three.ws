# NVIDIA Inception membership

three.ws is a member of the **NVIDIA Inception program**, NVIDIA's global program for startups building on accelerated computing. Membership was accepted in July 2026.

This page explains what that means in practice: what already runs on NVIDIA, what membership adds, and where it shows up in the product.

---

## Why NVIDIA is a natural fit

Every 3D generation lane on three.ws already runs on NVIDIA silicon:

- **Text-to-3D and image-to-3D** (the [/forge](https://three.ws/forge) free lane and the paid lanes) generate on NVIDIA GPUs on Cloud Run.
- **Photo-to-avatar reconstruction, auto-rigging, and motion capture** run on the same GPU fleet.
- **LLM chat, vision, embeddings, speech, and facial animation** run on NVIDIA-hosted models. The full model-by-model map is in [NVIDIA models on three.ws](/docs/nvidia-models).

GPU capacity is the single hardest constraint on how fast and how detailed generation can be, which is exactly the constraint Inception helps relax.

## What membership adds

- **GPU credits and hardware access** — more capacity for avatar generation and open-model inference, on top of the free-first lanes.
- **Technical guidance** — migrating the digital-human stack toward NVIDIA ACE (Audio2Face + Riva) and NIM / TensorRT-LLM.
- **Ecosystem access** — Omniverse/OpenUSD interop, co-marketing, the NVIDIA VC Alliance, and the wider Inception network.

Membership is a startup program, not a partnership or an investment: NVIDIA reviews applicants and admits companies building seriously on accelerated computing.

## Catalog and event consideration

NVIDIA clarified the operating path on 2026-09-14. Accelerated Application Catalog
consideration comes from a periodically reviewed Inception product record, not an automatic
publication button. A qualifying record must describe NVIDIA technology used at runtime,
be set to **Shipping**, distinguish technology currently used from technology only being
considered, include supporting Product Description and Technical Details, and carry a
product logo and brand color.

**Where we are.** three.ws filed its product record, **three.ws 3D AI Studio**, on
2026-10-25: Shipping, GPU Accelerated, with the NVIDIA technology it runs in production (CUDA
Toolkit, cuDNN, cuBLAS, CUDA Python, Kaolin, Riva, Audio2Face) listed separately from what is
only under evaluation (TensorRT, Triton Inference Server, Omniverse Kit). On 2026-11-02 we
followed up with the Inception team to confirm the record is complete and to ask when the
next review runs. NVIDIA curates the catalog, so three.ws is not listed yet. The listing
will be announced in the [changelog](https://three.ws/changelog) when it goes live.

The GTC Startup Pavilion is separate and invite-only. NVIDIA identifies potential
candidates from current member profiles, clear demos of NVIDIA acceleration, and ongoing
work with NVIDIA contacts. A public GTC call for submissions, when open, is a separate
speaking/poster route and should not be described as a Pavilion application.

## Where you'll see it

- The **NVIDIA Inception member badge** in the site footer, linking to [NVIDIA's startup program](https://www.nvidia.com/en-us/startups/).
- The [membership overview deck](/docs/nvidia-inception/index.html): the platform, the numbers, the team, and what we're doing with the program.
- The [changelog](https://three.ws/changelog), where membership was announced on 2026-07-21.
- The **Live right now** section of [/nvidia](https://three.ws/nvidia#live) and the full tables on [/nvidia/benchmarks](https://three.ws/nvidia/benchmarks) (see below).

## Live lane health and measured GPU numbers

Every NVIDIA lane the product depends on is probed on a schedule, and every GPU number comes from real generation jobs. Nothing on these pages is estimated: a lane or window without data says "no probes in the last N days" or "no jobs in the last N days".

| Lane | Technology | What the probe sends | Cadence |
|---|---|---|---|
| Chat, default NIM rung | NVIDIA NIM | 4-token chat completion on the model the LLM free chain leads with | hourly |
| Vision | NVIDIA NIM | one-word description of a 32x32 image | every 3 h |
| Embeddings | NVIDIA NIM | one-word embedding on the model `api/_lib/embeddings.js` pins | hourly |
| Content safety | NemoGuard | one-sentence safety classification | hourly |
| Text to speech | Riva (Magpie TTS) | "Hi." synthesized over NVCF gRPC | hourly |
| Speech to facial animation | Audio2Face-3D | one spoken phrase animated over NVCF gRPC (only the A2F call is timed) | every 3 h |
| Text to 3D, hosted TRELLIS | NVCF | authenticated status lookup, so no generation is consumed | hourly |
| TRELLIS, TRELLIS.2, Hunyuan3D, TripoSG, Pixal3D workers | NVIDIA GPU on Cloud Run | `GET /health`, which reports the GPU name and the loaded model | every 6 h |

**Pieces.** Lane registry and aggregation: [api/_lib/nvidia-lanes.js](../api/_lib/nvidia-lanes.js). Cron: [api/cron/nvidia-lane-probes.js](../api/cron/nvidia-lane-probes.js) at minute 23 every hour; each run probes only the lanes whose cadence is due (`?force=1` probes all, `?lane=a,b` picks lanes). Rows land in `nvidia_lane_probes`. Public read: `GET /api/nvidia/stats` (JSON, or `?format=csv`), CDN-cached for five minutes, with no keys, internal hostnames, user ids or prompts in the payload. Front end: [src/nvidia-live.js](../src/nvidia-live.js), shared by both pages. Local check against real endpoints on an isolated database: `node scripts/nvidia-lane-probes-check.mjs [lane...]`. Screenshot check: `node scripts/nvidia-live-shots.mjs http://localhost:3251`.

**Rate limits.** At most nine hosted requests an hour, against an NVIDIA free tier of about 40 requests per minute, so the probes never compete with product traffic. A probe that answers HTTP 429 is recorded as `degraded` with the limit in its detail; the response for that lane is to lengthen its `everyMinutes` in the registry. None hit a limit at the cadences above.

**GPU attribution.** Each completed forge job now records the worker host that served it (`forge_creations.worker_host`), and each GPU probe records the GPU that host reports. The fleet chart joins the two, so a job is split into L4 or RTX PRO 6000 only when both are known. Attribution started 2026-11-16; earlier jobs count in the lane totals but are never assigned a GPU.

**Methodology.** Probe latency is wall-clock time from our server in us-central1 to the full response, network included. Job latency is created-to-completed wall-clock time of real generations. All percentiles are nearest-rank (`percentile_disc`) over successful probes or completed jobs in the 7 or 30 day window.

**First findings (2026-11-16).** The first full run found the free chain's lead NIM rung still pinned to `nvidia/nemotron-3-super-120b-a12b`, which NVIDIA retired on 2026-10-03 (every call answered HTTP 410). The rung now leads with `nvidia/nemotron-3-ultra-550b-a55b`, and [tests/api/llm-nim-retired-pins.test.js](../tests/api/llm-nim-retired-pins.test.js) fails if any retired id is pinned again. The same run measured all seven hosted lanes live; the TRELLIS and TripoSG workers on NVIDIA L4 and Hunyuan3D on RTX PRO 6000 Blackwell answered in under 100 ms; the Pixal3D worker did not answer within the 4 s probe timeout from cold; TRELLIS.2 is not deployed on the production service and is shown as such.

## Related

- [Inception member perk](./nvidia-inception-perk.md): the $25 prepaid credit (plus $10 for a shoutout) other Inception startups can apply for on three.ws
- [NVIDIA visibility map](./nvidia-visibility-map.md): every NVIDIA surface where three.ws can earn recognition, what each one requires, and which membership benefits are still unclaimed
- [NVIDIA models on three.ws](/docs/nvidia-models) — the free inference layer, model by model
- [The generator was never the hard part](/docs/nvidia-nemotron-spotlight): our Nemotron Nano write-up, published on the NVIDIA Developer Forums
- [Image-to-3D on NVIDIA L4 and Blackwell](https://three.ws/blog/image-to-3d-on-nvidia-l4-and-blackwell): the engineering post on the GPU fleet itself: memory ceilings, `sm_120` kernels, and regional quota
- [How the forge works](/docs/how-forge-works) — the 3D generation pipeline the GPUs power
