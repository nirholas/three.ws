# NVIDIA models on three.ws — the free inference layer

If you generate a 3D model on [/forge](https://three.ws/forge), chat with an agent, or hear an avatar speak, there is a good chance an NVIDIA-hosted model did the work. This page is for developers and operators who want to know exactly which model sits behind each feature.

three.ws runs a large share of its AI on NVIDIA's free hosted models. **One key — `NVIDIA_API_KEY` (an `nvapi-…` token from [build.nvidia.com](https://build.nvidia.com)) — unlocks every model on this page.** There is no per-model billing, no per-seat cost, and no SLA: it is a rate-limited free tier, which is exactly why the platform treats it as a *free-first* lane and always keeps a fallback behind it.

This document is the canonical map of **which NVIDIA-hosted model does what, where it's wired, and why**. Every model and endpoint below is in production source — nothing here is aspirational.

As of July 2026, three.ws is also a **member of the NVIDIA Inception program** ([details](/docs/nvidia-inception)). The free hosted lane on this page is unchanged by that: membership adds GPU credits, hardware access, and engineering support on top of it, which is how the platform scales past free-tier rate limits without giving up the free-first design.

---

## How the platform talks to NVIDIA

NVIDIA exposes its catalog over a few distinct surfaces. three.ws uses four:

| Surface | Base URL | Shape | What runs here |
| --- | --- | --- | --- |
| **NIM (OpenAI-compatible)** | `https://integrate.api.nvidia.com/v1` | `chat/completions`, `embeddings` | LLM chat, vision (VLM), embeddings, content-safety |
| **GenAI invoke** | `https://ai.api.nvidia.com/v1/genai/…` | Async (202 + poll) or sync | TRELLIS text→3D, FLUX text→image |
| **Retrieval** | `https://ai.api.nvidia.com/v1/retrieval/<publisher>/<model>/reranking` (one URL per model) | Sync rerank | Cross-encoder reranking |
| **CV inference** | `https://ai.api.nvidia.com/v1/cv/nvidia/<model>` | Sync, one page image per call | PDF page layout, table structure, chart elements, OCR |
| **NVCF gRPC** | `grpc.nvcf.nvidia.com:443` | Riva gRPC | Magpie text-to-speech |
| **NVCF status** | `https://api.nvcf.nvidia.com/v2/nvcf/pexec/status/{id}` | Poll | Async job status (TRELLIS) |

Because it is one key for everything, a deployment either has the whole NVIDIA layer or none of it — every consumer below degrades gracefully when `NVIDIA_API_KEY` is absent.

---

## The catalog at a glance

| Capability | NVIDIA model(s) | Wired in | Free? |
| --- | --- | --- | --- |
| **Text → 3D** | `microsoft/trellis` | `api/_providers/nvidia.js`, `api/_lib/forge-tiers.js` | ✅ |
| **Text → image** | `black-forest-labs/flux.2-klein-4b` | `api/_mcp3d/text-to-image.js` | ✅ |
| **LLM (default lane)** | `nvidia/nemotron-3-super-120b-a12b`, then `nvidia/nemotron-3-ultra-550b-a55b` (step-down rung: `nvidia/nemotron-3.5-lightning-30b-a3b`) | `api/_lib/llm.js`, `api/_lib/chat-models.js` | ✅ |
| **LLM (model garden)** | Three Nemotron picks (Ultra 550B and 3.5 Lightning 30B behind them), plus DeepSeek V4.1 Flash on the NIM lane via the open-model roster | `api/brain/chat.js`, `api/_lib/model-roster.js` | ✅ |
| **Vision / VLM** | `nvidia/nemotron-3.5-super-vl-120b-a12b`, then `nemotron-3.5-bolt-e4b` and `nemotron-3-nano-omni-30b-a3b-reasoning` (per-task leads), then free OpenRouter `:free` VLM rungs | `api/_lib/vision.js` | ✅ |
| **Embeddings** | `nvidia/nemotron-3-embed-1b` in production; `nvidia/nemotron-3.5-embed-8b` under evaluation until the next `three-ws-api` deploy, then primary | `api/_lib/embeddings.js` (and `api/agents/_id/embed.js`, which delegates to it) | ✅ |
| **Reranking** | `nvidia/nemotron-3.5-rerank-8b` (under evaluation, opt-in) | `api/_lib/rerank.js` | ✅ |
| **Content safety** | `nvidia/llama-3.1-nemotron-safety-guard-8b-v3`, `meta/llama-guard-4-12b` | `api/_lib/publish-safety.js` | ✅ |
| **Chat guardrails** (owner opt-in) | `nvidia/nemoguard-jailbreak-detect`, `nvidia/llama-3.1-nemotron-safety-guard-8b-v3`, topic control on `nvidia/nemotron-3.5-lightning-30b-a3b` | `api/_lib/chat-guardrails.js` | Under evaluation |
| **Text-to-speech** | `magpie-tts-multilingual` (Riva) | `api/_lib/tts-nvidia.js` | ✅ |
| **Document extraction** (PDF knowledge) | `nvidia/nemotron-page-elements-v3`, `nvidia/nemotron-table-structure-v1`, `nvidia/nemotron-graphic-elements-v1`, `nvidia/nemotron-ocr-v2`, charts read by `nvidia/nemotron-3.5-super-vl-120b-a12b` | `api/_lib/pdf-extract.js`, `api/_lib/nvidia-doc-extract.js` | Under evaluation |
| **World video** (text or avatar scene to world) | `nvidia/Cosmos3-Nano` (open weights, self-hosted on one RTX PRO 6000), prompt upsampling on `nvidia/nemotron-3.5-super-vl-120b-a12b`; hosted `cosmos-predict1-7b` and `-5b` kept as fallback rungs (404 for this account) | `api/_lib/cosmos-ladder.js`, `api/_providers/cosmos-worker.js`, `workers/model-cosmos/` | Under evaluation |

---

## 1. Text → 3D — Microsoft TRELLIS

**Model:** `microsoft/trellis` · **Endpoint:** `ai.api.nvidia.com/v1/genai/microsoft/trellis` → poll `api.nvcf.nvidia.com/v2/nvcf/pexec/status/{id}`
**Source:** [api/_providers/nvidia.js](../api/_providers/nvidia.js), registered as the `nvidia` backend in [api/_lib/forge-tiers.js](../api/_lib/forge-tiers.js).

This is the headline free model. **Microsoft TRELLIS hosted on NVIDIA NVCF gives `/forge` a zero-vendor-cost text→3D lane that returns a textured GLB.** It is the default draft/standard engine for prompt generations, per the platform's free-first policy.

**Where it's used:**
- The `/forge` web app — draft and standard tiers default here (`FREE_DEFAULT_FOR_TIERS`).
- The free **`forge_free` MCP tool** — text prompt → downloadable GLB + viewer link, no payment, no wallet, no key.
- The **IBM × three.ws x402 demo** — the free generator next to the paid USDC Forge.
- The **auto-generation gallery** — a fresh community avatar every minute.

**How it works:**
- Async by default. Submit returns `202 + NVCF-REQID`; the forge polls the NVCF status endpoint until the GLB is ready (or the job completes synchronously within a 30 s window).
- **Sampling steps are pinned to the proven budget.** TRELLIS accepts 10 to 50 steps, but the hosted preview only returns inside the gateway's synchronous window at the low end, so the free lane runs `15/15` (`ss_sampling_steps` / `slat_sampling_steps`) for both draft and standard tiers. The `40/40` budget is reserved for a self-hosted TRELLIS NIM; the high tier itself defaults to the self-hosted Hunyuan3D engine, not this lane.
- Prompts are clamped to **77 characters** (TRELLIS truncates server-side) and get a `, studio lighting` suffix unless the caller already supplied lighting/color cues — without it TRELLIS defaults to dark, gritty output.
- Output GLBs arrive in several shapes over time (inline base64, bare string, CDN URL, numeric-keyed object, raw bytes); the extractor normalizes all of them, then **persists the bytes to R2** so three.ws owns a durable public URL.

**Key constraint: text only.** NVIDIA's *hosted preview* rejects every user-image input form (verified live 2026-06-11). So **photo to 3D never routes here**: it falls to the free reconstruct chain in `FREE_FALLBACK_FOR_PATH` (the self-hosted TRELLIS GPU worker first, then the self-hosted Hunyuan3D worker, then the free Hugging Face Spaces lane). A self-deployed TRELLIS NIM accepts real images; this is a hosted-preview limitation, not a model one.

---

## 2. Text → image: FLUX.2 klein 4B

**Model:** `black-forest-labs/flux.2-klein-4b` · **Endpoint:** `ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b`
**Source:** [api/_mcp3d/text-to-image.js](../api/_mcp3d/text-to-image.js).

FLUX.2 klein 4B is the **free NVIDIA text-to-image lane**. Probed live on 2026-11-26: `flux.1-dev` and `flux.1-schnell` accept a request on the hosted gateway and then never answer (70 s and 90 s probes hung), so the lane moved to klein-4b, which served a 1024x1024 JPEG in 6.5 s warm and 14 s cold. Request: 4 steps, CFG 1, no `mode` field (the endpoint rejects steps above 4, CFG above 1 and extra fields). The rung runs under its own 30 s cap and a 60 s cooldown after a degradation. It is a synchronous invoke: the image returns inline as base64, no poll.

**Where it's used:**
- **The reference-image step of the image-intermediate 3D path.** When a prompt is reconstructed to a mesh, FLUX paints the reference view first, which the free reconstruction lanes (TRELLIS / Hunyuan3D) then turn into geometry. A photo-quality reference reconstructs into a far better mesh than a busy scene, so the lane steers FLUX toward a clean, centered subject.
- General text→image wherever the platform needs a synthesized image.

**Ladder order.** When `GOOGLE_CLOUD_PROJECT` is set, Vertex Imagen leads by default because it outdraws distilled FLUX for photoreal reference images and spends the GCP credit pool the platform is funded to burn (`VERTEX_IMAGEN_FIRST=0` restores the NIM-first order). After that: NVIDIA FLUX.1-dev (free) → the Hugging Face router (`HF_TOKEN`; fal-ai, then WaveSpeed, both serving FLUX.1-schnell in a few seconds; `/api/v1/ai/image?health=1` probes each rung for credit and route) → the Livepeer federation lane (behind `LIVEPEER_FEDERATION_ENABLED`) → Pollinations (keyless, so a fallback always exists past every keyed rung) → Replicate `flux-schnell` ($0.003/image, the paid backstop). The whole ladder shares one budget, `TEXT_TO_IMAGE_BUDGET_MS` (default 60 s): each lane gets a bounded slice of what remains so a stalled provider cannot hold a Forge submit for minutes, and exhausting the budget returns a retryable `rate_limited` error (`retryAfter: 15`) rather than a hung request.

---

## 3. LLM chat & reasoning

NVIDIA NIM hosts 100+ open-weight chat models behind the one key, all OpenAI-compatible at `integrate.api.nvidia.com/v1/chat/completions`. three.ws uses them two ways.

### 3a. The default production lane

**Models:** `nvidia/nemotron-3-super-120b-a12b`, then `nvidia/nemotron-3-ultra-550b-a55b`, with `nvidia/nemotron-3.5-lightning-30b-a3b` as the compact step-down rung
**Source:** [api/_lib/llm.js](../api/_lib/llm.js), [api/_lib/chat-models.js](../api/_lib/chat-models.js).

The platform's general LLM helper runs a **free-first ladder: Groq → Cerebras → OpenRouter → NVIDIA NIM**, followed by further keyless free rungs (OVH, Gemini, Pollinations) and only at the very end a paid backstop (Anthropic/OpenAI). Every free rung was re-pointed on 2026-08-27, and every NVIDIA-routed id again on 2026-09-10 after a sweep of `GET /v1/models` on the live account found most of them answering `410 Gone`. A dead id is worse than a missing one: a fallback chain treats a 410 like a rate limit and moves on, so nothing logged an outage while each dead entry burned one of the chain's few retry slots. The rungs the providers still serve: Groq now runs `qwen/qwen3.8-27b` (instant tier `openai/gpt-oss-20b`), Cerebras keeps `llama-3.3-70b`, and the NVIDIA rung runs Nemotron 3 Super 120B, an NVIDIA MoE on an independent provider (the opt-in compact rung moved off `nemotron-3-nano-30b-a3b`, which NIM stopped serving, to `nemotron-3.5-lightning-30b-a3b`), so an outage on the other free lanes still answers here. Both NVIDIA rungs are called with thinking disabled (`chat_template_kwargs: { enable_thinking: false }`) so a chat turn answers instead of reasoning out loud. Both are tool/function-calling capable, so they are eligible for tool-required requests.

Since 2026-10-08 the shared chain runs all three Nemotron models on the one key, as separate rungs: Super 120B, then Ultra 550B right behind it, then Lightning 30B in the step-down group near the tail. Each NIM model is its own function with its own queue and its own retirement date, and NVIDIA sizes the free rate limit by model, so one model throttling, queueing, or answering 410 no longer takes the NVIDIA lane down with it. The third-party models the same key lists (DeepSeek V4.1 Flash, Kimi K3, GLM 5.3, Gemma 4) were probed the same day and each queued past 60 seconds on the free tier, so none of them is a chain rung. The same Nemotron Ultra and Super models are also reachable keylessly through the Kilo Code gateway, which the chain uses as a separate rung on Kilo's own capacity. `/api/cron/free-model-audit` checks every pinned NIM id against the live catalog every 6 hours and pages ops when one is retired. It also diffs the live NIM catalog against its last snapshot (kept 90 days in the cache) and pages ops once per newly listed model, so a fresh NVIDIA release can be wired on day 0; a cold cache seeds silently and a catalog outage skips the check. Full chain: [free-llm-providers.md](free-llm-providers.md).

This lane powers the platform's built-in AI surfaces — chat, embedded site widgets, the tutor, the fact-checker, persona tools, agent-to-agent talk, the transaction explainer — all of which lead with the free providers and only fall through to a paid model if every free lane fails.

### 3b. The Brain model garden

**Source:** [api/brain/chat.js](../api/brain/chat.js) and [api/_lib/model-roster.js](../api/_lib/model-roster.js). The Brain workbench lets users pick a model. Three picks are NVIDIA NIM natives on the single key:

| Brain label | Model id actually served | Tier | What it's for |
| --- | --- | --- | --- |
| Nemotron 3 Super 120B | `nvidia/nemotron-3.5-lightning-30b-a3b` | flagship | The slot's label is unchanged, but its native route moved to Lightning when the retired Super function started returning 404 (2026-10-24) |
| Llama-Nemotron Super 49B | `nvidia/nemotron-3-ultra-550b-a55b` | reasoning | Deepest Nemotron reasoning rung: math, code, planning |
| Nemotron Nano 9B | `nvidia/nemotron-3.5-lightning-30b-a3b` | balanced | Compact Nemotron with built-in reasoning, strong quality per token |

The DeepSeek, Kimi, Llama 4, Mistral, Qwen and Gemini picks are no longer hand-written NIM rows. They come from the open-model roster, where each model lists ordered routes (free lanes first, then Vertex AI Model Garden). The one roster model on the NIM lane today is DeepSeek V4.1 Flash (`deepseek-ai/deepseek-v4.1-flash`, free tier); Kimi K2 Thinking and DeepSeek V3.1 and R1 are paid picks that start on Vertex.

For anonymous (signed-out) callers, only the genuinely free tiers (the OpenRouter open-weight default, these three NVIDIA NIM picks, and the roster rows marked free) are selectable. Each NIM pick shows "unavailable" until the key is set. The picker labels are the Brain's own UI strings and were not renamed when the ids under them were re-pinned, so the id column is the one to trust. The routing catalog in `chat-models.js` lists `nvidia/nemotron-3-super-120b-a12b`, `nvidia/nemotron-3.5-lightning-30b-a3b`, and `nvidia/nemotron-3-ultra-550b-a55b` as the tool-capable NVIDIA models, its default NVIDIA model is `nvidia/nemotron-3.5-lightning-30b-a3b`, and the Brain's own fallback chain appends `nvidia/nemotron-3.5-lightning-30b-a3b` on NIM behind the OpenRouter rungs when a chosen route is dead.

> **Where the line is:** Nemotron and the `nvidia/…`-prefixed models are NVIDIA's own. The roster picks (DeepSeek, Kimi, Llama and the rest) are third-party open weights that NVIDIA *hosts and serves free* on NIM, so they ride the same key, but the model itself isn't NVIDIA's. The point of NIM is exactly this: one free key, a whole model garden.

---

## 4. Vision / VLM — image understanding

**Models on NIM:** `nvidia/nemotron-3.5-super-vl-120b-a12b` (first rung), `nvidia/nemotron-3.5-bolt-e4b`, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning`, all with thinking off
**Source:** [api/_lib/vision.js](../api/_lib/vision.js). **Eval:** [docs/nvidia/evals/vision-2026-11-16.md](nvidia/evals/vision-2026-11-16.md).

The order is measured. `npm run nvidia:vision-eval` scored every served NIM VLM on 66 licence-clean images and 162 graded tasks drawn from the real consumers, each with that consumer's own prompt, parser and time budget. On 2026-11-16 super-vl answered 92.6% correctly in budget (1.28 s p50), bolt-e4b 86.4% (1.17 s) and nano-omni 83.3% (0.98 s); mistral-large-4 (16.0%), muse-glimmer (32.1%) and step-5-preview (3.7%) lost mostly to slow or empty replies, gemma-4-31b timed out, and Workers AI Scout could not be scored behind a dead token. Super-vl therefore keeps the first rung, and `VISION_TASK_LEAD` routes the tasks the others won: the forge quality gate (bolt-e4b, 15 of 15) and X avatar review (bolt-e4b, a tie won on latency) lead with bolt-e4b, avatar alt text (100% vs 95.2%) leads with nano-omni, and every task keeps the rest of the chain behind its lead. Earlier NIM VLMs (`nemotron-nano-12b-v2-vl`, `llama-3.2-11b-vision-instruct` and the rest of the 2026 catalog) were retired with a hard `410` and are gone from the chain. Behind the NIM lane sit free OpenRouter `:free` VLM routes (Gemma 4, Ling 3.0 Flash VL, Nemotron Nano Omni and others), then Cloudflare Workers AI, Vertex Gemini, and the paid OpenAI backstop; the OpenRouter rung was added on 2026-09-09 after NVIDIA, OpenAI, and both Google routes failed in the same request and took every image-judging feature down at once. Only `:free` ids are listed there, because the spend ledger prices OpenRouter by that exact suffix. A caller's image URL is fetched by the chain itself (SSRF-guarded, 12 MB cap) and sent as base64, because hotlink-protected hosts reject the model servers' own fetch and bolt-e4b misread a URL it read correctly as base64; URL pass-through is the fallback when that fetch fails.

**Where it's used:**
- **Forge photo pre-check** — before a generation slot is spent, the uploaded photo is screened: a screenshot of text, a cluttered subject-less scene, or a too-dark image gets a heads-up and a fix (with a one-click "Generate anyway").
- **Fact Checker image evidence** — reads a picture alongside a claim, transcribes any text in it, and weighs it in the verdict.
- **Avatar gallery alt-text** — writes real, descriptive alt text from each avatar's thumbnail for screen-reader users.

All three **fail safe**: if the vision lane is unavailable, the feature quietly switches off — it never blocks or breaks the primary flow.

The chain is budgeted and remembers what hurt. Each attempt takes whatever remains on the caller's deadline minus a reserve for the next rungs (`laneAttemptTimeout`, never below 3.5 s, reserving for at most two further lanes), so the lane in hand spends the budget nobody else needs yet while every remaining rung keeps its floor. Dividing the deadline evenly instead starved the lane most likely to answer once the chain grew past a handful of rungs, and the pre-chain inline image fetch is capped at a quarter of the deadline and 8 s. A lane that fails is cooled for 45 s through the shared provider-health ledger (`api/_lib/provider-health.js`) and moved behind the healthy rungs on the next call rather than re-picked; a `429` cools every sibling lane on that host and skips them for the rest of the call, and a `401`/`403`/`402` earns the longer auth cooldown. A success clears the lane's cooldown.

---

## 5. Embeddings — semantic retrieval

**Primary:** `nvidia/nemotron-3.5-embed-8b` (2048-dim, Matryoshka `dimensions: 2048`) · **Endpoint:** `integrate.api.nvidia.com/v1/embeddings`
**Source:** [api/_lib/embeddings.js](../api/_lib/embeddings.js) (tag `NIM_EMBED_TAG` = `nvidia/nemotron-3.5-embed-8b@2048`).
**Status (2026-11-16):** committed, not yet deployed. Production still embeds with `nvidia/nemotron-3-embed-1b`; 8b counts as in production once `three-ws-api` is deployed and `npm run nvidia:reembed -- --verify` passes.
**Fallback / previous:** `nvidia/nemotron-3-embed-1b@2048` (`NIM_EMBED_TAG_PREVIOUS`), still live.

**Why 8b (2026-11-16 eval, [docs/nvidia/evals/embeddings-2026-11-16.md](nvidia/evals/embeddings-2026-11-16.md)):** on the labelled three.ws docs set nDCG@10 went from 81.3 to 91.3 and recall@5 from 92.0 to 100; BEIR SciFact +7.0 nDCG@10, NFCorpus +4.7. The hosted `nemotron-3.5-embed-1b` only tied the old model and was not adopted. 2048 keeps 99% of the 4096 quality at the same stored size as the model it replaced. Reproduce with `npm run nvidia:embed-eval`.

**Same dimension, different spaces.** Both models write 2048-dim vectors, so length cannot tell them apart: every vector row carries its `model@dim` tag, and every query is embedded with the model of the rows it is scored against (`scoreRowsBySpace`, `cosineInSpace` throws on a cross-space pair). The 3.5 models screen inputs and refuse some (HTTP 422, `code: 'content_refused'`, never a cooldown); `embedPassagesEach()` moves only the refused text to the previous model and keeps the rest of the batch in the new space. The Agent Galaxy population (`agent_embeddings`) stays pinned to the previous model, because diversity is measured within one space.

**Migrating stored vectors:** `npm run nvidia:reembed -- --status` shows per-table progress; a plain run re-embeds resumably (cursor in `embedding_migrations`, paced, backoff on 429/5xx, compare-and-swap per row) and copies each old vector into `embedding_prev` / `embedder_prev`. `--verify` compares new vs old space on production rows, `--restore --table <t>` rolls a table back. The prev columns are dropped by the held migration `api/_lib/migrations/held/20261116193100_drop_embedding_prev.sql`, promoted only after every table reads "verified".

`nv-embedqa-e5-v5` held this slot until NVIDIA ended its life on 2026-08-25. Its tag stays in the registry as `NIM_EMBED_TAG_RETIRED`, resolvable forever so vectors written in that space still read back, but reporting unconfigured so it is never picked for new work. Vectors are stored as `jsonb`, so the dimension change needed no migration.

The default embedder for new vectors: **free with the one key, 2048 dimensions**. Callers chunk to 512 input tokens, the cap of the fallback model, so any chunk can move to it. Vectors are tagged with `model@dimension` so a later model swap can't silently mix incompatible spaces. Powers **agent memory and knowledge-widget retrieval**; the paid embedding provider is demoted to backup behind it. At ingest, `embedPassagesAny()` walks every configured embedder in free-first order (NIM → Vertex → OpenAI, the caller's preferred tag first), cooling a lane that fails for 45 s (longer on an auth fault) so the next ingest starts on a healthy rung, and returns the tag it actually used so the document set is stamped with the space its vectors live in. Search-side, the Agent Galaxy falls back to lexical ranking when the embedder cannot answer, because a query vector from another model cannot be compared against vectors stored in a different space.

**Also:** the agent-embed endpoint [api/agents/_id/embed.js](../api/agents/_id/embed.js) does not carry a provider list of its own. It delegates to the registry above, so `POST /api/agents/:id/embed` serves this same model and returns the tag alongside the vector. It previously called `baai/bge-m3` directly; NVIDIA stopped serving that model on the hosted endpoint (500 on every request), which is exactly the failure mode a single registry prevents.

---

## 6. Reranking — sharpening retrieval

<a id="reranking"></a>

**Model:** `nvidia/nemotron-3.5-rerank-8b` (probed live 2026-11-16) · **Endpoint:** `ai.api.nvidia.com/v1/retrieval/nvidia/nemotron-3.5-rerank-8b/reranking`
**Source:** [api/_lib/rerank.js](../api/_lib/rerank.js) · **Eval:** [docs/nvidia/evals/rerank-2026-11-16.md](nvidia/evals/rerank-2026-11-16.md) · **Status:** under evaluation, opt-in.

Cosine-over-embeddings recall is cheap but coarse. This **cross-encoder reranker** re-scores the cosine pool (top 12) so the most relevant context leads the 4 chunks a chat turn is grounded in. It serves agent knowledge (`searchKnowledge`) and widget knowledge (chat and the studio's retrieval debugger).

- **Opt-in.** `KNOWLEDGE_RERANK_ENABLED=1` plus `NVIDIA_API_KEY`. The 2026-11-16 eval measured nDCG@5 1.000 against 0.860 for cosine when the model answers, but hosted queue latency failed the enable rule (served gain at least +0.05 and added p95 at most 1500 ms at the production timeout): at 2.5 s only 21 of 96 calls answered, and with no practical timeout the added p95 was 5.2 s.
- **Hard timeout, hedged, fail-open.** 2.5 s bounds the whole stage (`RERANK_TIMEOUT_MS`). A second request fires after 1 s, or at once on a 5xx/429/network error, and the loser is aborted. Any failure keeps the cosine order.
- **Content-safety split.** The hosted endpoint rejects a whole batch (422) when one passage trips its safety screen. The stage then scores each passage alone and merges by logit; a flagged passage keeps its cosine slot.
- **Retirement guard.** Hosted rerankers retire on a schedule and are never listed by `GET /v1/models`, so a 404/410 pauses the stage for 6 hours across instances (shared cache), records it once and pages ops (`sendOpsAlert`, signature `rerank:model-retired:<model>`). Re-pin with `KNOWLEDGE_RERANK_MODEL` after probing a replacement; the eval report lists the probe table and the URL shape.
- **Re-measure** with `node scripts/nvidia-rerank-eval.mjs run --timeout 2500` against the labelled set in `data/evals/rerank/questions.json`; `node scripts/rerank-live-check.mjs` runs one real retrieval through the dev server (:3254) with the stage off and on.

---

## 7. Content safety and chat guardrails: NemoGuard

**Primary:** `nvidia/llama-3.1-nemotron-safety-guard-8b-v3` · **Drop-in alt:** `meta/llama-guard-4-12b`
**Endpoint:** `integrate.api.nvidia.com/v1/chat/completions` · **Sources:** [api/_lib/publish-safety.js](../api/_lib/publish-safety.js), [api/_lib/chat-guardrails.js](../api/_lib/chat-guardrails.js).

The previous pin, `nvidia/llama-3.1-nemoguard-8b-content-safety`, was retired on 2026-11-16 (HTTP 410); Safety Guard v3 answers the same JSON verdict.

**Outbound publishing.** The Sketchfab showcase cron, which uploads visitor-generated models to our own official account on a third party's platform, classifies each source prompt first. The guard returns a **JSON verdict plus named risk categories** (harm, self-harm, weapons, sexual content and so on); the parser also accepts Llama Guard's `unsafe\nS#` text form, which is why the two are interchangeable.

**Agent chat guardrails (owner opt-in, under evaluation).** No three.ws chat surface screens visitors by default (owner directive 2026-08-07). An agent's owner can turn on, per agent, any of: jailbreak detection (`nvidia/nemoguard-jailbreak-detect`), content safety on the visitor's message and on the streamed reply (Safety Guard v3), and topic control with a polite redirect (`nvidia/llama-3.1-nemoguard-8b-topic-control`, currently answering 500, so `nvidia/nemotron-3.5-lightning-30b-a3b` judges with the same prompt). Input checks run in parallel with the model call inside a 2 s budget; the reply is screened sentence by sentence and replaced if a sentence is flagged. Covers `/api/chat` and the `<agent-3d>` embed proxy. Owners see block counts per check; no message text is stored. Setup and protocol: [docs/agent-guardrails.md](agent-guardrails.md).

Measured on 2026-11-16 ([eval report](nvidia/evals/guardrails-2026-11-16.md)): jailbreak detection 95.0% TPR at 0% FPR on 350 benign prompts (p50 455 ms); input safety 91% TPR on Aegis harmful prompts with 18.3% FPR on benign (25.6% on XSTest's deliberate traps, 0% on everyday requests); output safety 94% TPR on harmful replies; topic control 65% of off-topic turns caught at 1.8% FPR (p50 410 ms).

**Posture:** every check, on both surfaces, is **fail-open**: a timeout, error, rate limit or unparseable verdict lets the content through and is recorded as unchecked, so an NVIDIA outage never stops a publish or takes a guarded agent offline. Only a clean parsed flag blocks. Content safety is not a jailbreak detector; that is the separate jailbreak check.

---

## 8. Text-to-speech — Magpie (Riva)

**Model:** `magpie-tts-multilingual` · **Transport:** Riva gRPC at `grpc.nvcf.nvidia.com:443`
**Source:** [api/_lib/tts-nvidia.js](../api/_lib/tts-nvidia.js) (mirrored in `packages/avatar-agent-mcp/src/lib/tts-nvidia.js`).

The free NVIDIA TTS lane: **Magpie multilingual on Riva**, selected by an NVCF `function-id`, speaking over the standard Riva gRPC synthesis contract (protos shipped in `api/_lib/riva-protos/` and loaded from a generated descriptor, so there's no `.proto` build step). Drives **avatar speech** with multilingual voices. Configured by the presence of `NVIDIA_API_KEY`; returns synthesized audio bytes, with a clear error if the lane returns empty audio.

---

## 9. Document extraction: NeMo Retriever page models

<a id="document-extraction"></a>

**Models:** `nvidia/nemotron-page-elements-v3`, `nvidia/nemotron-table-structure-v1`, `nvidia/nemotron-graphic-elements-v1`, `nvidia/nemotron-ocr-v2` (charts read by `nvidia/nemotron-3.5-super-vl-120b-a12b`) · **Endpoint:** `ai.api.nvidia.com/v1/cv/nvidia/<model>`
**Source:** [api/_lib/pdf-extract.js](../api/_lib/pdf-extract.js) (per page), [api/_lib/nvidia-doc-extract.js](../api/_lib/nvidia-doc-extract.js) (model calls), [api/_lib/knowledge-pdf-jobs.js](../api/_lib/knowledge-pdf-jobs.js) (job, fallback) · **Eval:** [docs/nvidia/evals/pdf-extraction-2026-11-16.md](nvidia/evals/pdf-extraction-2026-11-16.md) · **Status:** under evaluation until the `three-ws-api` deploy that ships it.

A PDF uploaded to an agent's knowledge is read page by page as layout: page elements boxes tables, charts and text; table structure gives each table its row and column grid, filled from the text layer or from OCR when the page is scanned or the table is a pasted screenshot; graphic elements plus the VLM turn a chart into labelled values. Each table becomes one chunk with its caption, so an agent answers "what does model X score on Y" from the right cell. Feature doc: [docs/agent-knowledge.md](agent-knowledge.md#how-pdfs-are-read).

- **Measured.** On 44 questions over three CC BY 4.0 papers and a scanned copy, answer accuracy went from 38.6% (MarkItDown) to 90.9%: born-digital tables 77.3% to 100%, charts 0% to 75%, screenshot tables 0% to 100%, scanned pages 0% to 81.8%. Every exact value reached the prompt (37/37).
- **Job, not a request.** Upload answers `202`; the panel steps the job (about 20 s of reading per call) and shows per-page progress with a live table preview; the `knowledge-pdf-jobs` cron finishes abandoned jobs.
- **Fallback.** If the layout models fail for a document, it is read with MarkItDown (or the text layer) instead and the source is marked "Read as plain text". `KNOWLEDGE_PDF_EXTRACTOR=text` forces that path.
- **Data path.** Page images are sent to NVIDIA's hosted API for the duration of the call; only the extracted text is stored.
- **Re-measure** with `npm run nvidia:pdf-eval`; `npm run knowledge:pdf-live-check` uploads a real PDF through the dev server and asks the agent a table question.

---

## 10. World video: Cosmos 3 Nano

<a id="world-video"></a>

**Model:** `nvidia/Cosmos3-Nano` through diffusers, self-hosted on a Cloud Run RTX PRO 6000 Blackwell (`model-cosmos`, europe-west4) · **Prompt upsampler:** `nvidia/nemotron-3.5-super-vl-120b-a12b` on NIM
**Source:** [api/_lib/cosmos-ladder.js](../api/_lib/cosmos-ladder.js) (rungs), [api/_providers/cosmos-worker.js](../api/_providers/cosmos-worker.js) (worker client), [api/_providers/nvidia-cosmos.js](../api/_providers/nvidia-cosmos.js) (hosted predict1), [workers/model-cosmos](../workers/model-cosmos/README.md) · **Eval:** [docs/nvidia/evals/cosmos-2026-11-16.md](nvidia/evals/cosmos-2026-11-16.md) · **Status:** under evaluation until the `three-ws-api` deploy that ships the ladder (the worker is live).

[/cosmos](https://three.ws/cosmos) renders a short world video that plays behind a transparent 3D avatar. One checkpoint serves four modes: text, image (a still of the avatar's scene becomes frame 0), and depth or edge (a three.js render of the avatar on a 4-second orbit steers the layout). Before sampling, the worker expands the prompt into Cosmos 3's structured caption with the Nemotron model above; if that call fails it samples on the plain prompt and records `upsampler: "none"`. Feature doc: [docs/cosmos.md](cosmos.md).

- **Measured.** Five prompts at 720p and 121 frames: median 245.7 s from submit to a playable URL on a warm worker, with sampling flat at about 229 s. A still-conditioned world took 4m 05s and a depth-conditioned one 17m 44s. The first world after scale-to-zero adds a 1041.5 s checkpoint load.
- **Ladder.** Cosmos 3 Nano leads. The hosted `cosmos-predict1-7b` and `cosmos-predict1-5b` Text2World rungs follow for text mode only. Both answer 404 "Not found for account" as of 2026-11-16, and the ladder steps past them.
- **Jobs.** Submit answers `202` with a job id. The worker keeps every task in GCS, so a reload, another API instance or a worker restart resumes the same job. Progress is the worker's real step count and ETA.
- **Re-measure** with `node scripts/nvidia-cosmos-eval.mjs`. `node scripts/verify-nvidia-cosmos.mjs --probe-only` checks each rung.

---

## Day-0 release pipeline

**Source:** [api/cron/nim-release-eval.js](../api/cron/nim-release-eval.js), [api/_lib/nim-lanes.js](../api/_lib/nim-lanes.js), [api/_lib/nim-lane-eval.js](../api/_lib/nim-lane-eval.js), [api/_lib/nim-release-store.js](../api/_lib/nim-release-store.js), eval sets in [data/evals/](../data/evals/).

A model that appears in the NIM catalog goes from "listed" to an evaluated, ready-to-apply proposal without anyone touching it:

1. **Enqueue.** `/api/cron/free-model-audit` diffs the catalog against its snapshot every 6 hours and inserts each new id into `nim_release_evals` (unique on the model id, so a cold snapshot cache can never queue a model twice).
2. **Classify.** `/api/cron/nim-release-eval` runs every 15 minutes and claims one queued row (`for update skip locked`). The lane comes from live probes, never from the name: a vector from `/v1/embeddings` is embeddings; a chat reply that is a safety verdict is safety; a chat model that names the colour of a drawn square is vision; any other chat reply is chat; a full ranking from the retrieval host is rerank. A 410 is retired, an account 404 is not entitled, a timeout or 5xx is requeued (up to 3 attempts), and a model that answers none of these (speech is gRPC) is stored as skip.
3. **Evaluate.** The lane's versioned set (`data/evals/<lane>/v1.json`, CC0) runs against the candidate and against the model the lane runs today, called the way production calls it (for example embeddings at the pinned Matryoshka dimension). Each run records quality (accuracy, recall@1, top-1 or verdict accuracy), format adherence, error rate and p50/p95 latency.
4. **Decide.** Reject when errors pass 20%, format adherence is under 80% or quality is under the lane floor (70%, 80% for safety). Adopt when the lane's current model is down, when quality is 5 points better, or when quality is within 2 points at no more than 1.25x the p50. Hold within 5 points; reject otherwise. A model that is already the lane's first rung is scored as a baseline of production against the floor.
5. **Propose.** Adopt and hold rows get the exact unified diff against the lane's config file (`git apply`-ready) and a post draft carrying the measured number. The row, the markdown report and both go to ops in one alert (`llm:nim-release-eval:<model>`) and to **[/admin/nim-releases](https://three.ws/admin/nim-releases)** (platform admin with two-step verification, or the ops secret).

**Nothing switches production.** No pipeline module writes a file or touches the env (a test enforces both and hashes the lane files around a full adopt run). A person applies the diff, runs the lane's tests, deploys and verifies, then posts.

Run it by hand: `node scripts/nvidia-lane-eval.mjs --model <id>` (one model, writes `docs/nvidia/evals/<lane>/<id>.{json,md,diff}`), `--backfill` (the 2026-11-06 backlog), or `--pipeline <id>` (the full enqueue, claim, evaluate and store path on a throwaway database). First end-to-end run, 2026-11-16: `nvidia/nemotron-3.5-bolt-e4b` was probed as a vision model and returned adopt, 86% vs 79% accuracy for the current vision rung with 100% format adherence ([run record](./nvidia/evals/pipeline/nvidia_nemotron-3.5-bolt-e4b.md)).

---

## Design principles across every lane

1. **Free-first, always.** NVIDIA NIM leads its category (or sits in a free trio with Groq/OpenRouter) before any paid model is touched. Cost to the platform is $0.
2. **One key, whole layer.** `NVIDIA_API_KEY` is the only credential. Present → the layer is live; absent → every consumer degrades to its next lane or switches off cleanly.
3. **Fail-open / fail-safe.** Safety, rerank, and vision never break the primary flow — a NVIDIA outage downgrades quietly, it doesn't error the user.
4. **Independent fallbacks.** Where reliability matters, the fallback is a *different model family* (vision) or a *different provider* (chat), not a retry of the same thing.
5. **It's a free tier, not an SLA.** Rate-limited, no uptime guarantee — great for the default path precisely because there's always something behind it.

---

## Environment

| Variable | Unlocks |
| --- | --- |
| `NVIDIA_API_KEY` | Every model on this page (`nvapi-…` from build.nvidia.com) |
| `KNOWLEDGE_RERANK_ENABLED=1` | Turns on the rerank stage (§6) |
| `KNOWLEDGE_RERANK_MODEL` | Re-pins the reranker after a retirement (§6) |
| `KNOWLEDGE_PDF_EXTRACTOR=text` | Skips the layout models and reads PDFs with MarkItDown or the text layer (§9) |
| `FORGE_PREFER_FREE` | Free-first reconstruct ordering (default on) |
| `TEXT_TO_IMAGE_BUDGET_MS` | Shared deadline for the whole text-to-image ladder (§2), default 60000 |
| `VERTEX_IMAGEN_FIRST=0` | Puts the free NIM FLUX lane ahead of Vertex Imagen again (§2) |
| `HF_TOKEN` | Unlocks the Hugging Face router rungs (fal-ai, WaveSpeed) in the text-to-image ladder (§2) |
| `COSMOS_WORKER_URL`, `COSMOS_WORKER_KEY` | The self-hosted Cosmos 3 Nano world rung (§10) |
| `NVIDIA_COSMOS_INVOKE_URL` | Pins the hosted Cosmos predict1 rungs to one endpoint (§10) |

---

## Related

- [NVIDIA Inception membership](/docs/nvidia-inception) - what membership adds on top of this free lane
- [The generator was never the hard part](/docs/nvidia-nemotron-spotlight) - our Nemotron Nano write-up, published on the NVIDIA Developer Forums
- [NIM model retirements and the 410 that hides from a fallback chain](https://forums.developer.nvidia.com/t/nvidia-nim-model-retirements-what-a-410-gone-does-to-a-fallback-chain-and-how-we-survive-it-now/383950) - the forum post behind the 2026-09-10 re-pins on this page
- [A digital human in a browser tab](https://forums.developer.nvidia.com/t/a-digital-human-in-a-browser-tab-streaming-audio2face-3d-onto-whatever-rig-the-visitor-brought/383953) - Riva, Magpie and Audio2Face-3D on one WebGL face, measured against production
- [Image-to-3D on NVIDIA L4 and Blackwell](https://three.ws/blog/image-to-3d-on-nvidia-l4-and-blackwell) - the self-hosted GPU fleet behind the paid lanes, and the two walls we hit moving to Blackwell
- [How Forge works](/docs/how-forge-works) - the /forge product this layer powers
- [REST API](/docs/api-reference) - the endpoints these models serve
- [Configuration](/docs/configuration) - all environment variables
- [MCP](/docs/mcp) - the `forge_free` MCP tool on the free TRELLIS lane
