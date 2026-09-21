---
venue: NVIDIA Developer Forums
category: AI & Data Science > NVIDIA NIM > Models (the category both approved posts landed in)
account: nichxbt
suggested_title: "NVIDIA NIM model retirements: what a 410 Gone does to a fallback chain, and how we survive it now"
description: "Both models featured in our two earlier NVIDIA forum posts were retired from the hosted NIM catalog within weeks of publication. A 410 Gone is invisible to a well-behaved fallback chain, so nothing alerted for two weeks. What we changed: 410 as a permanent verdict, embedding vectors tagged with model and dimension, pins verified against GET /v1/models with a real call, and three lifecycle signals we would ask NVIDIA to add."
tags: [nim, nemotron, llama]
links_in_body: 2, both to forums.developer.nvidia.com (our own earlier topics). No external hyperlinks; three.ws and repo paths are plain text on purpose.
images: 0
status: draft, owner approval required before posting (external-channel gate in CLAUDE.md)
---

# NVIDIA NIM model retirements: what a 410 Gone does to a fallback chain, and how we survive it now

I have posted here twice about running three.ws (open source, text to rigged 3D characters in a browser) on the hosted NIM endpoints. In July I wrote about [putting Nemotron Nano VL in front of our text-to-3D generator](https://forums.developer.nvidia.com/t/how-nemotron-made-three-ws-text-to-3d-pipeline-usable/376445), and a week later about [translating the app into 100+ languages with Llama 3.3 70B on NIM](https://forums.developer.nvidia.com/t/how-three-ws-translates-a-web-app-into-100-languages-with-nvidia-nim-an-llm-powered-i18n-pipeline/377379).

Both posts now document a model id that no longer answers.

`nvidia/nemotron-nano-12b-v2-vl`, the protagonist of the first post, returns this on every request:

```
HTTP 410
... has reached its end of life on 2026-08-26T09:00:00Z
```

`meta/llama-3.3-70b-instruct`, the model in the second post, reached end of life the same day. `nvidia/nv-embedqa-e5-v5`, which held all of our agent memory, went the day before.

Models get retired. That is normal, it is the price of a catalog that keeps moving, and I am not here to complain about it. I am here because of the part that surprised me: **we did not notice for two weeks**, and the reason we did not notice is a property of every well-built fallback chain. If you run hosted NIM in production behind a failover, you probably have the same blind spot, so here is the whole thing with the real code.

## What actually died

On 2026-09-10 I checked every NVIDIA-routed model id in our tree against `GET /v1/models` on the live account. The result:

| Model id | Role in our stack | Status |
|---|---|---|
| `nvidia/nemotron-nano-12b-v2-vl` | Input check in front of every photo-to-3D job | 410, EOL 2026-08-26 |
| `meta/llama-3.3-70b-instruct` | NIM rung of the chat chain, i18n default | 410, EOL 2026-08-26 |
| `nvidia/nv-embedqa-e5-v5` | Agent memory and knowledge retrieval | 410, EOL 2026-08-25 |
| `nvidia/nemotron-3-nano-30b-a3b` | Compact reasoning rung | 410 |
| `nvidia/nvidia-nemotron-nano-9b-v2` | Prompt refinement, classification | 410 |
| `nvidia/llama-3.3-nemotron-super-49b-v1.5` | User-selectable model | 410 |
| `meta/llama-4-maverick-17b-128e-instruct` | User-selectable model | 410 |
| `nvidia/rerank-qa-mistral-4b` | Optional rerank stage | 404 for the account |

Three of the four NVIDIA ids in our chat model registry were dead. Production had been serving traffic the whole time, and no alert had fired.

## Why a 410 is invisible

Here is the uncomfortable part. Everything I recommended in the July post (fail open, make the second lane a different family, never let a vendor's bad afternoon become your outage) is exactly what hid this.

A fallback chain is a machine for converting upstream errors into silence. A 429 arrives, the chain moves to the next rung, the user gets an answer, nothing is logged above debug level. That is the design working. But a chain that only asks "did this rung answer?" treats a 410 the same way it treats a 429. It moves on. The user still gets an answer. And it does this on every single request, forever, because unlike a 429, a 410 never recovers.

So the cost was not an outage. It was quieter than that:

1. **Every dead id burned a retry slot.** Our chains deliberately allow a small number of attempts per request. A dead rung spends one of them on a model that cannot answer, so the chain reached its paid backstop, or gave up, sooner and more often than designed.
2. **The dead rung took the largest slice of the deadline.** Our vision chain gives the first lane the biggest share of the caller's time budget. For two weeks that share went to a 410.
3. **The free lane stopped being free.** In vision and embeddings the NIM lane leads because it costs nothing. With those rungs dead, traffic landed on the rungs behind them. The product worked. The economics had silently changed.

A dead id is worse than a missing id. A missing id fails a config check. A dead id passes every check you have and degrades you politely.

## Fix 1: a 410 is a permanent verdict, so treat it like a bad key

Our provider-health ledger already had two cooldown classes: 45 seconds for a lane that is throttled or failing, 300 seconds for a key or billing fault that will not clear on its own. The fix was deciding which class a 410 belongs to. From api/_lib/vision.js:

```js
const st = upstream.status;
// 410 Gone is how NIM reports a retired model id. Unlike a 404 or a 500 it
// is a permanent verdict about this model, so it parks the lane for the
// long window instead of being re-probed (and re-charged a slice of the
// deadline) on every request until someone notices.
const authFault = st === 401 || st === 403 || st === 402 || st === 410;
coolLane(order, p, {
  seconds: authFault ? AUTH_COOLDOWN_SECONDS : VISION_LANE_COOLDOWN_SECONDS,
  reason: authFault ? 'auth' : 'health',
  hostWide: st === 429,
});
```

Note the last line too. A 429 is the one status that is unambiguously about the host and the account, so it benches every sibling model on that host for the rest of the request. A 410 is about one model, so it benches one lane. Getting that scoping wrong in either direction costs you redundancy.

The status code taxonomy we ended up with:

- **429**: the host is throttling you. Cool every lane on that host for 45 seconds.
- **5xx**: this lane is sick. Cool it alone for 45 seconds, retry soon.
- **401 / 402 / 403**: the account is broken. Park the lane for 300 seconds so it is probed every few minutes instead of on every request.
- **410**: the model is gone. Same long window, with one difference in what a human should do about it: the other three say "investigate", this one says "re-pin", because it will never come back.

## Fix 2: embeddings are the retirement with state

A chat model swap is stateless. An embedding model swap is not: every vector the free lane had written lived in the `nv-embedqa-e5-v5` space at 1024 dimensions, and a query vector from a different model cannot be compared against them.

What saved us is a decision made months earlier for a different reason. Every stored vector carries a tag of the form `model@dimension`:

```js
export const NIM_EMBED_TAG = 'nvidia/nemotron-3-embed-1b@2048';
// The retired NIM embedder. Rows embedded before 2026-09-10 carry this tag and
// resolve through it forever [...] It is deliberately absent
// from INGEST_PREFERENCE, so it is resolvable but never chosen.
export const NIM_EMBED_TAG_RETIRED = 'nvidia/nv-embedqa-e5-v5@1024';
```

The retired tag stays in the registry permanently, with its `configured()` hard-wired to `false`. That gives it exactly the right semantics: old rows still know what space they live in and what their dimension is, and no code path can ever select the dead model for new work. New documents embed with `nvidia/nemotron-3-embed-1b`. Two details worth copying:

- **Measure the dimension from a live call, do not read it off a model card.** We pinned 2048 because that is what the endpoint returned, and stored vectors as `jsonb` so the dimension change needed no migration.
- **Search falls back to lexical ranking** when the query cannot be embedded in the same space as the stored vectors. A worse ranking is a degraded feature. A cosine similarity across two different spaces is a wrong answer delivered with confidence.

If you take one thing from this post: tag your vectors with the model and dimension that produced them, today, before you need it.

## Fix 3: re-pin from the catalog, verify with a real call

Every replacement id came from `GET /v1/models` on our own key, not from memory or a model card, and each one was verified with a real request before it was committed. Where our registry claims a model supports tool calling, the verification was a real tool-call payload. A model that is listed is not necessarily a model your account can call, and a model that answers chat is not necessarily a model that answers tools.

Two smaller rules that came out of it:

**A pin verified dead beats a guess not verified alive.** The reranker has no live replacement on our account that answers on the reranking endpoint. We left the dead id pinned, with a comment saying so and the date. The stage is opt-in and fails open (any error keeps the original cosine order), so a documented dead pin is harmless, and a plausible-looking guess is how you create the next silent failure.

**Tests import the pin, they do not restate it.** The compact Nemotron id has been re-pinned twice now. Both times, tests that spelled the model id out by hand went red for a reason that had nothing to do with the code. They now assert against the exported constant.

## The replacements are reasoning models, and that changes the request

The ids that serve now are from the Nemotron 3 family (`nemotron-3-super-120b-a12b`, `nemotron-3.5-lightning-30b-a3b`, `nemotron-3-ultra-550b-a55b`). They reason by default. If you drop one into a slot that used to hold Llama 3.3, you must also send:

```js
chat_template_kwargs: { enable_thinking: false }
```

Measured on a five-string translation chunk on 2026-09-10: **40 output tokens in 1.1 seconds with thinking off**, against hundreds of tokens and many seconds with it on. Worse, inside a tight `max_tokens` budget the thinking can consume the whole allowance and you get `finish_reason: length` with an empty `content`. A chain that treats providers as interchangeable will get empty answers from exactly the rung that is healthy.

For anyone who built the i18n pipeline from my July post, here is the head-to-head that picked its new default. Six sustained 60-key chunks each, same key, same afternoon:

| Model | Chunks landed | Median per chunk | Throughput |
|---|---|---|---|
| `nvidia/nemotron-3-ultra-550b-a55b` | 5 of 6 | 10.3 s | 225 keys/min |
| `nvidia/nemotron-3-super-120b-a12b` | 3 of 6 | 35.4 s | 73 keys/min |

The larger model was the faster lane, because the smaller one was the model the free tier was throttling that day. Ultra also translated the hard scripts (Sinhala, Amharic, Khmer, Lao) with nothing left in English. Benchmark on your payload, on your key, on the day. And one trap: `nvidia/riva-translate-4b` looks like the obvious choice for a translation job, but it is a sentence-in, sentence-out model, so it echoes the English back for a JSON payload. It is the right model for a different pipeline.

## The gap I still own

We run a scheduled audit every six hours that diffs hardcoded model ids against a provider's live model list and alerts on anything that vanished. One design rule in it is worth stealing: an empty live list means the provider was unreachable, so the verdict is `unknown` and nothing is flagged dead. Never call a model dead on your own outage.

That audit was written for a different provider, after that provider retired a batch of ids overnight. The NIM pins were the ones we still checked by hand, which is the entire reason this post exists. The lesson is not subtle: the audit belongs on every catalog you pin against, and the one you trust most is the one you will forget.

## Three things I would ask of NVIDIA

Offered the same way as last time, from a team that has built on these endpoints and intends to stay on them.

1. **Put lifecycle data in `GET /v1/models`.** A `deprecation_date` or `end_of_life` field per model would let every client audit its own pins with one request. The 410 body already knows the exact timestamp. Exposing it before the date instead of after would have turned our two silent weeks into a calendar entry.
2. **Send a `Deprecation` or `Sunset` response header in the weeks before retirement.** It costs nothing on the wire, and it lights up in logs and proxies while the model still works, which is the only time a warning is useful.
3. **Name a successor in the 410 body.** "Reached end of life on 2026-08-26, consider nvidia/x" would make the failure self-documenting for the engineer who finds it in a log at 2 a.m.

And one genuine question, because I may simply have missed it: **is there an existing feed, changelog, or mailing list for hosted catalog retirements?** I see several threads in this category from people discovering a retirement the same way we did, by a request failing. If there is a canonical place to watch, I would like to wire our audit to it and I suspect others here would too.

## Checklist, if you run hosted NIM behind a fallback

1. Grep your tree for every pinned model id. Diff the list against `GET /v1/models` on your own key today.
2. Classify 410 as permanent in your health logic, and make it page someone.
3. Log which rung answered each request, and alert when your first rung's share of answers drops to zero. "The chain worked" is not a health signal.
4. Tag stored vectors with `model@dimension`. Keep retired tags resolvable, never selectable.
5. When the replacement is a reasoning model, turn thinking off explicitly and re-check your `max_tokens`.
6. Verify a replacement with a real call of the kind you will actually make (tools, JSON mode, images), not a hello-world.
7. Put a timeout on every request. Twice in one bulk translation run that week, a stalled socket with no deadline read as "the lane died" when it was simply blocked forever.

Everything quoted above is in the open repository (nirholas/three.ws on GitHub): api/_lib/vision.js, api/_lib/embeddings.js, api/_lib/provider-health.js, and docs/nvidia-models.md for the current model map. I will add a note to both of my earlier posts pointing here, so nobody copies a dead model id out of them.

If you have been through the same thing, I would like to hear how you caught it.
