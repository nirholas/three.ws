# LLM lanes: what actually serves traffic, what it costs, and how to add Claude

The platform never calls one model. Every text surface runs an ordered chain of
providers and falls through it on any failure, so the question "which model
answered" has a different answer per request. This doc is the operator's view of
that chain: which rungs are alive, which are dead and why, how spend is metered,
and the exact command to add Claude when a key arrives.

Every number here was measured, not remembered. Re-measure before trusting it:
the probe commands are in [Probing a lane](#probing-a-lane) and they take
seconds.

---

## The chain

`api/_lib/llm.js` builds it. Free rungs first, always, because the paid keys in
production are routinely dead and a chain that depends on them fails:

| # | Rung | Key | Cost to us | State |
|---|---|---|---|---|
| 1 | Groq `qwen/qwen3.8-27b` | `GROQ_API_KEY` | free | **serving** (200, ~0.4s, 2026-09-04). Capped at 8,000 tokens/MINUTE, which is ~3 fact-check stance calls: a burst falls past it while it is perfectly healthy. |
| 1b | Groq `openai/gpt-oss-120b` | `GROQ_API_KEY` | free | **serving** (200, ~1.4s, 2026-09-04). Added 2026-09-04. Same key, separate 8,000 tok/min bucket, because Groq meters per model id. |
| 2 | Cerebras `llama-3.3-70b` | `CEREBRAS_API_KEY` | free | not configured in prod |
| 3 | OpenRouter `:free` routes, one rung per key | `OPENROUTER_API_KEY`, `OPENROUTER_FALLBACK_KEYS` | free | **model id was dead 2026-09-04**: `openai/gpt-oss-20b:free` was retired and 404'd all five rungs at once (fixed, now `google/gemma-4-31b-it:free`). The account is separately capped at 1,000 free-model requests/DAY across every key (they share one owner), and was at 0 remaining when measured. |
| 4 | NVIDIA NIM `nvidia/nemotron-3-super-120b-a12b` | `NVIDIA_API_KEY` | free | **serving** (200, 1.8s-10.5s on a full-size prompt, 2026-09-04). Carried the whole platform on 2026-09-04 when Groq was token-capped, OpenRouter was dead, and both paid anchors were on billing holds. |
| 4b | NVIDIA NIM `nvidia/nemotron-3-ultra-550b-a55b` | `NVIDIA_API_KEY` | free | **serving** (200, 1.8s through `llmComplete`, 2026-10-08). Added 2026-10-08. A separate NIM function on the same key, so it survives the Super function being throttled, queued, or retired. |
| 5 | SambaNova `Meta-Llama-3.3-70B-Instruct` | `SAMBANOVA_API_KEY` | free | added 2026-08-05; skipped when the key is unset |
| 6 | Mistral `mistral-small-latest` (Experiment tier) | `MISTRAL_API_KEY` | free | added 2026-08-05; skipped when the key is unset |
| 7 | Z.AI `glm-4.7-flash` | `ZAI_API_KEY` | free | added 2026-08-05; skipped when the key is unset |
| 8 | Cloudflare Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_AI_API_TOKEN` | free | added 2026-08-05; skipped when either is unset |
| 8b | Hugging Face Inference Providers `meta-llama/Llama-3.3-70B-Instruct` | `HF_TOKEN` (+ `HF_FALLBACK_TOKENS`) | free (monthly included credit) | configured in prod; 402s in ~100ms once a token's credit is spent |
| 8c | Kilo Code `nvidia/nemotron-3-ultra-550b-a55b:free`, then `nvidia/nemotron-3-super-120b-a12b:free` | none (keyless) | free | **serving** (200, Ultra 2.0s and Super 0.6s through `llmComplete`, 2026-10-08). Added 2026-10-08. About 200 req/hr anonymously, on Kilo's own NVIDIA capacity. Sends `reasoning: {enabled: false}`. |
| 9 | OVH AI Endpoints `Meta-Llama-3_3-70B-Instruct` | none (keyless) | free | **serving** (200, ~1.2s, 2026-08-02) |
| 10 | Gemini Flash-Lite (AI Studio) | `GEMINI_API_KEY` | free | not configured in prod |
| 11 | **Vertex Gemini Flash** | GCP service account | GCP credits | **dead**: 403 `Lightning dunning decision is deny for project` since 2026-08-27, re-measured 2026-09-04. A billing hold on the whole GCP project, not IAM. This is the chain's designed anchor, so while it is down the free rungs above it are load-bearing rather than best-effort. |
| 12 | Pollinations `openai-fast` | none (keyless) | free | **serving** (200, ~3.7s, 2026-08-02) |
| 13 | LLM7.io `gemma4:31b` | none (keyless); `LLM7_API_KEY` optional | free | **serving keyless** (200, 1.1s through `llmComplete`, 2026-10-08). The anonymous tier answered 401 on 2026-09-02 and reopened for LLM7's `turbo` models; the old pin `gemini-3.1-flash-lite` moved to the paid `pro` tier. Keyless again since 2026-10-08. |
| 14 | SiliconFlow `Qwen/Qwen3-8B` | `SILICONFLOW_API_KEY` | free | added 2026-08-05; skipped when the key is unset |
| 14b | NVIDIA NIM `nvidia/nemotron-3.5-lightning-30b-a3b` | `NVIDIA_API_KEY` | free | **serving** (200, 0.7s through `llmComplete`, 2026-10-08). Added 2026-10-08 as a step-down: a third NIM function on the primary key. |
| 15 | Groq `openai/gpt-oss-20b` | `GROQ_API_KEY` | free | serving (a third separate per-model quota) |
| 16 | Vertex Claude | GCP service account + `VERTEX_CLAUDE_ENABLED=1` | GCP credits | **off and unentitled** (see below) |
| 17 | Anthropic first-party | `ANTHROPIC_API_KEY` | paid | **absent** (no key anywhere) |
| 18 | OpenRouter Claude mirror | `OPENROUTER_CLAUDE_MIRROR_MODEL` | paid | off by default (see below) |
| 19 | OpenAI `gpt-5.4-nano` | `OPENAI_API_KEY` | paid | **dead**: 429 `billing_not_active` |
| 20 | xAI Grok `grok-4.3`, reasoning off (`GROK_BUDGET_MODEL`) | `GROK_API_KEY` (or `XAI_API_KEY`) | paid | not configured in prod: no key in `.env`, `.env.local`, the `three-ws-api` service, or Secret Manager (checked 2026-10-08). A caller's own xAI key leads the chain instead, on `grok-4.7` unless they name a model. See [Grok model ids](#grok-model-ids). |

The 2026-08-05 widening (SambaNova, Mistral, Z.AI, Cloudflare, LLM7,
SiliconFlow) added six independent free quota pools; each is documented with
its tier limits in `docs/free-llm-providers.md`. The 2026-10-08 round added
the Nemotron Ultra and Lightning rungs on the existing NIM key, the keyless
Kilo Code gateway, and made LLM7 keyless again, so the keyless floor a
zero-env deployment falls to is now five rungs across four providers: Kilo
(Ultra, then Super), OVH, Pollinations, and LLM7. OVH and Pollinations both
answered 429 from this workspace's shared egress IP on 2026-09-02, so treat any
single keyless rung as best-effort: the floor is real because it is wide, not
because any one rung is a substitute for a key.

Rungs 1 to 15 are not a degradation path any more. They are production. Every
one of them is covered by a transport-level failover test
(`tests/api/llm-free-chain-reachability.test.js`): each case kills the rungs
above it the way a provider actually dies (dropped socket, abort, empty 503) and
requires the next rung to answer. A fallback that only catches a parse error is
bypassed exactly when the provider fails, which is the defect class that test
exists to prevent.

`/brain` (`api/brain/chat.js`) runs its own chain with the same shape: requested
model → OpenRouter mirror of that model → free safety net (Groq → OpenRouter
`:free` per key → NVIDIA → SambaNova → Mistral → Z.AI) → the Vertex Gemini
anchor.

### Why the paid rungs are out

- **OpenAI**: the account returns `429 "Your account is not active, please check
  your billing details"`. The key is set and valid; the billing is not. Every
  OpenAI backstop in the platform is therefore a wasted attempt.
- **OpenRouter platform key**: `total_credits: 30`, `total_usage: 30.24`. Spent.
  It burned on paid vendor mirrors routed through `/brain`, and the metering
  reported `$0` for all of it (see [Metering](#metering)). The `:free` routes on
  the fallback keys still serve.
- **Anthropic**: no `ANTHROPIC_API_KEY` in `.env`, `.env.local`, or on the
  `three-ws-api` service. `api/chat.js`, `api/_lib/llm.js` and the embed proxy
  `api/llm/anthropic.js` reach Claude only through `api.anthropic.com`, so they
  get no Claude at all. `/brain` is the exception: it reaches Claude through the
  OpenRouter mirrors, which is why the Claude rows in its menu are selectable.
- **Vertex Claude**: `VERTEX_CLAUDE_ENABLED=0`, `VERTEX_CLAUDE_PRIMARY=0`, and
  the project is not entitled. `rawPredict` returns `404 Publisher model ... not
  found` for every Claude id in both `global` and `us-east5` while the same
  token serves Gemini fine. Flipping the flag alone would 404 every request.

---

## Adding Claude: one command

When an `ANTHROPIC_API_KEY` arrives, this is the whole rollout:

```sh
gcloud run services update three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 --update-env-vars ANTHROPIC_API_KEY=sk-ant-...
```

`--update-env-vars` merges. **Never `--set-env-vars`**: it replaces the entire
env set and would strip every other variable on the service.

No code change is needed. The key is read by `env.ANTHROPIC_API_KEY` and appends
an Anthropic rung to the tail of every chain automatically, ahead of the dead
OpenAI backstop and behind every free lane.

### Rate limits: keep it off the high-QPS lanes

A fresh Anthropic account starts at **Tier 1**, which is a low requests-per-minute
and tokens-per-minute ceiling, not a per-day budget. Tier 1 traffic must stay on
the low-volume surfaces:

- **Allowed**: `/chat`, `/brain`, reflection and backstop traffic. These are
  human-paced, so a per-minute ceiling is invisible.
- **Not allowed**: the x402 ring or any other agent loop that issues sustained
  automated requests. A Tier 1 key behind a machine-paced lane 429s continuously,
  and the chain then treats Claude as a dead rung on every request.

Raise the tier before widening the lanes. Two model notes that will otherwise
look like bugs:

- `claude-fable-5` requires 30-day data retention on the org. Under zero data
  retention it returns `400`.
- `claude-mythos-5` is deliberately absent from the `/brain` menu: it is
  restricted-access, so listing it would render a selectable row that 404s at
  call time. It stays in `MODEL_CATALOG` as an explicit-only, BYOK-reachable id.

### The interim option: the OpenRouter Claude mirror (off by default)

`api/chat.js` and `api/_lib/llm.js` have no OpenRouter mirror for Claude the way
`/brain` does. One exists but is **off unless explicitly enabled**, because it
spends real money on the platform key for ordinary agent traffic:

```sh
# Only with owner approval: this draws real spend.
gcloud run services update three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 \
  --update-env-vars OPENROUTER_CLAUDE_MIRROR_MODEL=anthropic/claude-sonnet-5
```

What it costs: the mirror bills the underlying model's list price. Sonnet 5 at
$3/$15 per 1M tokens is about **$0.006 on a 1,000-in / 300-out turn**, so roughly
**$6 per thousand such turns**. Opus 5 at $5/$25 is about 1.9x that. The platform
key's $30 balance is already spent, so enabling this also requires funding the
key first.

Guardrails, all enforced in code:

- The model must be registered `paid: true` in `MODEL_CATALOG`
  (`isPaidModel()`), or the rung is refused with a warning. That registration is
  what makes it metered rather than priced as free openrouter traffic, and what
  keeps it away from anonymous callers.
- It sits in the **paid tail**, after every free rung, never leading.
- It is skipped entirely when a caller BYOK key, a server `ANTHROPIC_API_KEY`, or
  Vertex Claude is available. It is a gap-filler, not a competitor.

---

## Metering

`api/_lib/llm-pricing.js` is the single source of truth for "what did that call
cost us", and the rule is: **a lane that spends money must never report exactly
$0.**

That rule was violated in the most expensive way possible. `openrouter` sat on a
blanket free-provider list, and OpenRouter namespaces every model by vendor
(`anthropic/claude-opus-5`), which matched no key in the price table. So a
$5/$25-per-1M-token Claude turn priced to zero twice over, and a real $30 balance
drained while the dashboard read "served free" the entire way down.

How it works now:

- OpenRouter is free **only** on its `:free` routes. Vendor mirrors price at the
  underlying model, including the dotted ids OpenRouter uses
  (`anthropic/claude-haiku-4.5` resolves to `claude-haiku-4-5`).
- Every OpenRouter request opts into usage accounting (`usage: {include: true}`)
  and records `usage.cost`, the exact amount the account was charged. A reported
  cost always outranks the price table. This works for the direct-fetch chain and
  for the AI SDK routes in `/brain` (`api/_lib/openrouter-usage.js` wraps the
  provider's `fetch`, injects the opt-in, and reads the cost off a teed copy of
  the response so streaming is untouched).
- An unpriceable spending lane records **`null` (unknown)** and logs a warning.
  It never records `0`. `usage_events.cost_micro_usd` is nullable precisely so
  unknown reads as unknown.
- `/brain` writes a `kind:'llm'` usage event per turn. It previously wrote
  nothing at all, which is why its spend was invisible. `api/chat.js` now writes
  provider, model, tokens and cost in their own columns rather than only in
  `meta`. BYOK routes record `0`: the caller's key, not the platform's.
- The one unmetered `/brain` lane is watsonx. IBM bills its trial entitlement
  outside per-token pricing, so there is no honest per-call number to record.

### The check

```sh
npm run audit:llm-metering              # last 24h
npm run audit:llm-metering -- --hours 168
npm run audit:llm-metering -- --json
```

It aggregates `usage_events` by provider and model and fails (exit 1) when any
lane with traffic reports exactly `$0` without being genuinely free, when any
call recorded an unknown cost, when tokens were served with no provider
recorded, or when a free lane somehow booked spend. It is read-only and needs
`DATABASE_URL`. The rule itself lives in `api/_lib/llm-metering-rule.js` and is
unit-tested in `tests/llm-metering-rule.test.js`, so the guard is proven to fire
without writing fake rows into the production ledger.

It is not wired into `npm run gate`: the gate is offline and this needs the
database. Run it after any change to a provider chain or the price table.

## X search through xAI

Not a chat lane, but the same key. `api/_lib/x-search.js` falls back to xAI's
built-in `x_search` tool (Responses API) when our own X bearer cannot answer.
It needs `GROK_API_KEY` or `XAI_API_KEY`, is capped per UTC day by
`XAI_X_SEARCH_DAILY_CAP` (default 200), and is documented in
[docs/sentiment-scout.md](../sentiment-scout.md#failover-x-search-through-xai).
No xAI key is configured in production yet, so the rung is dormant.

## Grok model ids

xAI retires model ids in batches. On 2026-05-15 it retired eight at once,
including the `grok-4-1-fast` pair behind the `grok-4.1-fast` slug this
platform used as its budget Grok, and redirected them to `grok-4.3` at
`grok-4.3` prices. Our ids were typed by hand in a dozen files, so the stale
slug outlived the retirement everywhere.

There is now one list: `GROK_MODELS` in `api/_lib/chat-models.js`. Each row
carries the id, context window, function calling, image input, reasoning and
the `reasoning_effort` values it accepts, list price, the OpenRouter mirror id,
whether Chat Completions can serve it, and whether model menus show it.
Everything reads from it:

| Consumer | What it takes |
|---|---|
| `api/_lib/llm.js` | the BYOK default (`GROK_DEFAULT_MODEL`, the flagship) and the server backstop (`GROK_BUDGET_MODEL` with `GROK_BUDGET_EXTRA_BODY`) |
| `api/brain/chat.js` | one `/brain` row per menu model, which also feeds `GET /api/v1/models` and the shared model picker |
| `api/chat.js`, `api/llm/anthropic.js`, `api/v1/_providers.js` | the routable ids and the xAI URL |
| `api/marketplace/[action].js`, `api/_lib/wallet-intents.js`, `api/agents/solana-intent.js` | the budget model for previews and intent compiling |
| `api/_lib/llm-pricing.js` | every Grok price, including retired slugs for historical rows |
| `src/avatar-page.js`, `src/nich-agent.js`, `src/editor/manifest-builder.js` | the menu rows |

Current set (xAI docs, 2026-10-08): menus show `grok-4.7` (flagship),
`grok-4.3` (cheapest, 1M context), `grok-4.20-0309-non-reasoning` (no thinking
pass) and `grok-build-0.1` (coding). `grok-4.6`, `grok-4.5` and
`grok-4.20-0309-reasoning` are still live and routable when a caller names
them; menus show their `supersededBy` model instead. `grok-4.20-multi-agent-0309`
is catalogued but never routed, because xAI serves it through the Responses
API only.

**Retired ids keep working.** `GROK_RETIRED_ALIASES` maps every retired slug to
the successor xAI itself redirects it to (`grok-4.1-fast` → `grok-4.3`,
`grok-code-fast-1` → `grok-build-0.1`, and so on). `resolveModelId()`,
`routableGrokModelId()` and the `/brain` alias table all run through it, so an
agent, embed policy, BYOK caller or saved menu pick that stored a retired id
gets its successor instead of an upstream 404. An id the catalog has not met
yet passes through untouched, so a BYOK caller can use a model xAI shipped
today.

**The guard.** `tests/grok-model-literals.test.js` fails `npm test` when a Grok
id appears as a string literal anywhere in `api/`, `src/` or `server/` outside
`chat-models.js`, and holds the catalog to its invariants (every alias target
is live, the budget model accepts the reasoning knob we send, every Grok price
comes from the catalog).

**The drift check.** `npm run check:xai-models`
(`scripts/check-xai-models.mjs`) compares `GROK_MODELS` with what xAI serves
and exits 1 on drift, 2 when the source cannot be read:

```sh
npm run check:xai-models                 # API with a key, else the public docs
npm run check:xai-models -- --source=docs
npm run check:xai-models -- --json
```

With `GROK_API_KEY` or `XAI_API_KEY` set (environment, `.env` or `.env.local`)
it reads `GET https://api.x.ai/v1/models` and `/v1/language-models`. Without
one it reads https://docs.x.ai/developers/models.md and the per-model pages
under `https://docs.x.ai/developers/models/<id>.md`, and says so in its first
line. Drift is: a catalogued id xAI no longer lists (retire it into
`GROK_RETIRED_ALIASES`), an id xAI now serves only as an alias of another, a
new xAI text model we have not catalogued, or a changed context window, price,
image input, function calling or reasoning-effort set. Fix it in
`GROK_MODELS`; nothing else needs touching. Run it whenever xAI announces a
model, and before turning on a server `GROK_API_KEY`.

---

## Probing a lane

A set key is not a working key. That is the entire lesson of the OpenAI rung, so
never conclude a lane is healthy from a config read.

```sh
# Any OpenAI-compatible lane (groq / nvidia / openai / openrouter / ovh):
curl -s -X POST https://api.groq.com/openai/v1/chat/completions \
  -H "authorization: Bearer $GROQ_API_KEY" -H 'content-type: application/json' \
  -d '{"model":"llama-3.3-70b-versatile","max_tokens":16,"messages":[{"role":"user","content":"say ok"}]}'

# OpenRouter balance (the number that went to zero unnoticed):
curl -s -H "authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/credits

# Vertex Claude entitlement: 404 here means Model Garden terms are not accepted.
TOK=$(gcloud auth print-access-token)
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d '{"anthropic_version":"vertex-2023-10-16","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}' \
  "https://aiplatform.googleapis.com/v1/projects/aerial-vehicle-466722-p5/locations/global/publishers/anthropic/models/claude-sonnet-5:rawPredict"

# What production actually has set (every API key is a Secret Manager
# reference since 2026-09-02, so read them through the resolver):
node scripts/read-service-env.mjs '_API_KEY$' --names   # which secret backs each
node scripts/read-service-env.mjs '^OPENAI_API_KEY$' --raw   # one value
```

---

## Owner actions

Named here rather than waited on. The platform serves traffic without any of
them:

1. **Reactivate OpenAI billing**, or accept that every OpenAI rung is a dead
   attempt. (Removing the key entirely would be cheaper than leaving it dead.)
2. **Fund the OpenRouter platform key**, or accept `:free`-only OpenRouter. The
   fallback keys still serve free routes today.
3. **Accept Anthropic terms in Vertex Model Garden** for
   `aerial-vehicle-466722-p5`. This is the only gate on billing Claude to the
   GCP credits. Then re-probe `rawPredict` (above) and set
   `VERTEX_CLAUDE_ENABLED=1`; the Claude 5 ids are already in
   `VERTEX_ANTHROPIC_MODELS`.
4. **Supply an `ANTHROPIC_API_KEY`** if first-party Claude is wanted before
   Vertex entitlement lands. One command, above.
5. **Supply a `GROK_API_KEY`** (xAI console) if a platform-paid Grok rung is
   wanted. Without it Grok serves only callers who bring their own key. Once it
   is set, run `npm run check:xai-models -- --source=api` to diff the catalog
   against the account's live model list.

## Related

- [gcp-credits.md](gcp-credits.md): the credit program, the Vertex lanes, and
  the revert runbook.
- [gcp-production.md](gcp-production.md): the full production runbook.
- `api/_lib/llm.js`: the chain itself, with the policy comment at the top.
- `api/_lib/chat-models.js`: the model catalog, capability flags, and
  `isPaidModel()`; `GROK_MODELS` is the only place a Grok id is written.
- `scripts/check-xai-models.mjs`: the Grok drift check described above.
