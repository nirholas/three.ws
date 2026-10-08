# Free LLM providers: the failover chain

three.ws never depends on a single AI vendor. Every text completion on the platform (chat, agent brains, copilots, translations) runs through one shared failover chain that tries free providers first, in order, and only touches a paid key as a last resort. This page is the map of that chain: which providers are in it, what each one costs (nothing), where the keys come from, and how to add the next one.

The chain lives in [`api/_lib/llm.js`](../api/_lib/llm.js) (`providerChain()` + `llmComplete()`). The interactive chat ladder in [`api/chat.js`](../api/chat.js) uses the same policy with a shorter list (see `DEFAULT_PROVIDER_ORDER` in [`api/_lib/chat-models.js`](../api/_lib/chat-models.js)).

## The chain, in order

Free rungs run first, 70B-class models before smaller ones. A keyed rung is skipped when its env var is unset; the four keyless providers (Kilo Code, OVH, Pollinations, LLM7) are always present, so the chain can never be empty.

| # | Rung | Model | Key | Free tier |
|---|------|-------|-----|-----------|
| 1 | Groq | `qwen/qwen3.8-27b` | `GROQ_API_KEY` | Per-minute and per-day caps, no card. Llama 3.x left Groq's catalog in August 2026; Qwen 3.8 27B is the fastest non-reasoning model left there. Groq meters tokens PER MODEL ID at 8,000 tokens/minute, so the ceiling is small and the fix is more model ids, not a bigger plan. [console.groq.com](https://console.groq.com) |
| 2 | Groq | `openai/gpt-oss-120b` | `GROQ_API_KEY` | Same key, a second independent 8,000 tok/min bucket. Added 2026-09-04 to widen the burst Groq absorbs before the chain leaves it. Do not reach for `groq/compound-mini` instead: it advertises 70,000 tok/min but routes internally to `llama-3.3-70b-versatile`, whose 100,000 tokens/DAY org cap makes it 429 while its own headers still read nearly full. |
| 3 | Cerebras | `llama-3.3-70b` | `CEREBRAS_API_KEY` | About 1M tokens/day. [cloud.cerebras.ai](https://cloud.cerebras.ai) |
| 4 | OpenRouter | `google/gemma-4-31b-it:free`, then alternate `:free` models | `OPENROUTER_API_KEY` (+ fallback keys) | `:free` models only; the platform key is never billed. OpenRouter retires `:free` slugs with no notice and a retired id 404s every rung built off it, so `/api/cron/free-model-audit` diffs the hardcoded ids against the live list every 6 hours. The extra keys widen nothing on their own when they belong to one account: the free-model cap (1,000 requests/day) is per ACCOUNT, not per key. [openrouter.ai](https://openrouter.ai) |
| 5 | NVIDIA NIM | `nvidia/nemotron-3-super-120b-a12b` | `NVIDIA_API_KEY` (+ `NVIDIA_FALLBACK_KEYS`) | Free developer tier, about 40 req/min. `meta/llama-3.x` on NIM reached end of life on 2026-08-26 (HTTP 410); Nemotron 3 is a reasoning family, so the rung sends `enable_thinking: false` to keep the answer in `content`. [build.nvidia.com](https://build.nvidia.com) |
| 6 | NVIDIA NIM | `nvidia/nemotron-3-ultra-550b-a55b` | `NVIDIA_API_KEY` (+ fallback keys) | Same key. Added 2026-10-08: the largest free model in the chain (1.6s, clean output). Every NIM model is its own function with its own queue and retirement date, and NVIDIA sizes the free rate limit by model, so this rung keeps answering when the Super function above is throttled, queued, or retired. |
| 7 | SambaNova | `Meta-Llama-3.3-70B-Instruct` | `SAMBANOVA_API_KEY` | About 20 req/min, 200K tokens/day per model, no card. [cloud.sambanova.ai](https://cloud.sambanova.ai) |
| 8 | Mistral | `mistral-small-latest` | `MISTRAL_API_KEY` | Experiment tier: about 1B tokens/month at 1 req/sec (account opts into data training). [console.mistral.ai](https://console.mistral.ai) |
| 9 | Z.AI | `glm-4.7-flash` | `ZAI_API_KEY` | Permanently free, rate-limited Flash models. [z.ai](https://z.ai), docs at [docs.z.ai](https://docs.z.ai) |
| 10 | Cloudflare Workers AI | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_AI_API_TOKEN` | 10,000 neurons/day, shared across every Workers AI model (so more Cloudflare models would add no quota). [developers.cloudflare.com/workers-ai](https://developers.cloudflare.com/workers-ai/) |
| 11 | Hugging Face Inference Providers | `meta-llama/Llama-3.3-70B-Instruct` | `HF_TOKEN` (+ `HF_FALLBACK_TOKENS`) | The token's small monthly included credit; an exhausted token answers 402 and the chain moves on. [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) |
| 12 | Kilo Code | `nvidia/nemotron-3-ultra-550b-a55b:free`, then `nvidia/nemotron-3-super-120b-a12b:free` | none (keyless); `KILO_API_KEY` optional | Added 2026-10-08. About 200 req/hr with no key and no signup, on Kilo's own NVIDIA capacity (a quota pool separate from our nvapi key). Only `:free` ids are requested, so it cannot bill. The rungs send `reasoning: {enabled: false}`, without which the answer lands in the reasoning field. [kilo.ai](https://kilo.ai) |
| 13 | OVHcloud AI Endpoints | `Meta-Llama-3_3-70B-Instruct` | none (keyless) | Anonymous trial lane, 2 req/min per IP. |
| 14 | Gemini (AI Studio) | `gemini-2.5-flash-lite` | `GEMINI_API_KEY` | AI Studio free tier, no card. [aistudio.google.com](https://aistudio.google.com) |
| 15 | Vertex Gemini | `google/gemini-2.5-flash` | GCP service account | The reliability anchor: billed to platform GCP credits, no third-party quota. |
| 16 | Pollinations | `openai-fast` | none (keyless) | Anonymous, always on. |
| 17 | LLM7.io | `gemma4:31b` | none (keyless); `LLM7_API_KEY` optional | About 30 req/min per IP anonymously. Keyless again since 2026-10-08: the anonymous tier answered 401 on 2026-09-02 and has since reopened for LLM7's `turbo` models. The old pin, `gemini-3.1-flash-lite`, moved to the paid `pro` tier. A free key at https://dash.llm7.io/#/api-keys only raises the limit. |
| 18 | SiliconFlow | `Qwen/Qwen3-8B` | `SILICONFLOW_API_KEY` | Free-tier small model, own quota pool. [siliconflow.com](https://siliconflow.com) |
| 19 | NVIDIA NIM | `nvidia/nemotron-3.5-lightning-30b-a3b` | `NVIDIA_API_KEY` | Added 2026-10-08 as a step-down: a third NIM function on the primary key (0.7s). Skipped when a `preferNvidia` caller already led the chain with this model. |
| 20 | Groq instant | `openai/gpt-oss-20b` | `GROQ_API_KEY` | Separate per-model quota from rungs 1 and 2. |

After rung 20 come the paid backstops (Vertex Claude, Anthropic, OpenAI, Grok), which never lead and which no flow depends on.

The interactive chat ladder (`/api/chat`) uses: groq → openrouter → nvidia → sambanova → mistral → zai → paid backstops, with the Vertex Gemini anchor always appended at the tail. SambaNova, Mistral, and Z.AI are also selectable as explicit `provider` values in the chat API, and anonymous callers may use them. When every anonymous-eligible free lane is throttled or in cooldown at once, `/api/chat` answers `503 rate_limited` ("The AI chat is at capacity right now") with a `Retry-After: 20` header and the `providers_tried` list, never a 401 asking a signed-out visitor to sign in for a throttle they cannot fix.

## Why so many

Every rung is an independent quota pool on independent infrastructure. Free tiers throttle, retire models without notice (OpenRouter dropped its whole `:free` Llama roster in one day, Groq and NVIDIA NIM both removed Llama 3.x in August 2026, GitHub Models was retired outright in 2026), and queue under load (NVIDIA NIM). One provider failing costs nothing; the chain moves on in under a second. The platform's baseline reliability is the product of how many independent free lanes stand between a request and an error.

Providers and models evaluated and deliberately excluded:

- **Third-party models on NVIDIA NIM** (DeepSeek V4.1 Flash, Kimi K3, GLM 5.3, Gemma 4 31B, Muse Glimmer): listed in the NIM catalog on our key, but each queued past 60 seconds on the free tier when probed on 2026-10-08, while the Nemotron family answered in 0.6 to 1.6 seconds. A rung that stalls costs the chain its whole timeout.
- **Ollama Cloud, ModelScope, Aion Labs**: Ollama's free tier publishes no limits (session and weekly caps that reset on its schedule); ModelScope requires Alibaba Cloud real-name verification; Aion Labs caps at 20K tokens/day. None beats the rungs above.

- **GitHub Models**: retired. Brownouts (HTTP 410) began in August 2026, and by 2026-10-08 both `models.github.ai/catalog/models` and the inference endpoint answered a bare `OK` text body with no models and no completion.
- **Cohere**: the free trial key is licensed for non-commercial use only, which three.ws does not satisfy.

## Cost accounting

All of these rungs are zero-marginal-cost, and the accounting knows it:

- `FREE_PROVIDERS` in [`api/_lib/llm-pricing.js`](../api/_lib/llm-pricing.js) prices their traffic at $0 (vs "unpriced", which is an audit failure).
- The per-user daily spend cap in `checkUserLlmSpendCap()` ([`api/_lib/llm.js`](../api/_lib/llm.js)) excludes them, so free traffic can never lock a user out.

## Keeping the pins alive

`/api/cron/free-model-audit` runs every 6 hours. It diffs the hardcoded OpenRouter `:free` ids against OpenRouter's live list, and the NVIDIA NIM pins (`NVIDIA_PINNED_MODELS`) and Kilo pins (`KILO_FREE_MODELS`) against their own catalogs. NIM's catalog lists models an account cannot call and Kilo's lags what it serves, so an id missing from those two listings is only reported dead after a live 1-token call answers 404 or 410. A dead id pages the ops channel with the constant to update.

## Adding the next provider

1. Get the model id and OpenAI-compatible endpoint (nearly every free tier has one; probe it with `curl` before writing code).
2. `api/_lib/env.js`: add the key getter with a comment stating the tier's limits.
3. `api/_lib/llm.js`: add a model `const` with rationale, then a guarded `chain.push(openaiCompatProvider({...}))` at the right rung: 70B-class before step-downs, always before the Vertex anchor if free.
4. `api/_lib/llm-pricing.js`: add the provider name to `FREE_PROVIDERS`; add it to the spend-cap exclusion list in `llm.js`.
5. `tests/api/llm-free-chain-reachability.test.js`: add the rung to `HOSTS`/`FREE_CHAIN`/`ENV_KEYS`; the exact-order assertion fails until you do.
6. If the provider should be user-selectable in chat: register it in `api/chat.js` (`PROVIDERS`, the provider enum, `FALLBACK_SIBLINGS`) and `api/_lib/chat-models.js` (`MODEL_CATALOG`, `PROVIDER_MODEL_DEFAULTS`, `DEFAULT_PROVIDER_ORDER`, `ANON_PROVIDER_LIST`).
7. `.env.example` and the env tables in [`ARCHITECTURE.md`](../ARCHITECTURE.md).

Related: [nvidia-models.md](nvidia-models.md) for the full NVIDIA NIM surface map.
