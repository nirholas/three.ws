# Embedding model eval, 2026-11-16: nemotron-3-embed-1b vs nemotron-3.5

**Decision:** new agent memory, agent knowledge and widget knowledge vectors move from
`nvidia/nemotron-3-embed-1b@2048` to **`nvidia/nemotron-3.5-embed-8b@2048`**.
On the three.ws docs set nDCG@10 rises from 81.3 to 91.3 (+10.0) and recall@5 from 92.0 to 100.
The gain holds on two public BEIR sets: +7.0 nDCG@10 on SciFact, +4.7 on NFCorpus.
Same 2048 dimensions, same free NIM key, faster at the median.

Reproduce: `npm run nvidia:embed-eval -- --datasets docs,scifact,nfcorpus --latency-n 20`
(script: [scripts/nvidia-embed-eval.mjs](../../../scripts/nvidia-embed-eval.mjs), metrics:
[scripts/lib/embed-eval-core.mjs](../../../scripts/lib/embed-eval-core.mjs), raw numbers:
[embeddings-2026-11-16.json](embeddings-2026-11-16.json)).

## Method

- **three-ws-docs**: 44 hand-labelled questions over 425 docs/ pages split into 496 passages
  ([data/evals/nvidia-embed/three-ws-docs-qrels.json](../../../data/evals/nvidia-embed/three-ws-docs-qrels.json)).
  This is the closest stand-in for agent knowledge: product docs, API sections, code blocks.
- **BEIR SciFact** (300 queries, 5183 passages) and **BEIR NFCorpus** (323 queries, 3633 passages): public, out-of-domain
  checks so the decision does not rest on one in-house set.
- Every passage is truncated to 2048 characters (under the 512-token cap of the old model) for every model, so no
  model is judged on longer inputs. Queries use `input_type: query`, passages `input_type: passage`, exactly as
  [api/_lib/embeddings.js](../../../api/_lib/embeddings.js) calls them.
- Reduced dimensions: 8b is asked for 4096, then truncated and renormalized to 2048 and 1024 (Matryoshka). The
  hosted 3.5-1b is evaluated the same way at 2048, 1024 and 512.
- A passage the model refuses (content-safety 422) gets no vector and can never be retrieved; a refused query finds
  nothing. The new models are scored with that penalty, which is stricter than production (see "Content screening").

## Results

### three-ws-docs (44 queries, 496 passages)

| Model @ dim | recall@5 | recall@10 | nDCG@10 | refused passages / queries |
|---|---:|---:|---:|---:|
| nemotron-3-embed-1b@2048 (current) | 92.0 | 97.7 | 81.3 | 0 / 0 |
| nemotron-3.5-embed-1b@2048 | 92.0 | 97.7 | 81.3 | 2 / 0 |
| nemotron-3.5-embed-1b@1024 | 87.5 | 93.2 | 78.6 | 2 / 0 |
| nemotron-3.5-embed-1b@512 | 85.2 | 89.8 | 73.2 | 2 / 0 |
| nemotron-3.5-embed-8b@4096 | 100.0 | 100.0 | 92.2 | 2 / 0 |
| **nemotron-3.5-embed-8b@2048 (chosen)** | **100.0** | **100.0** | **91.3** | 2 / 0 |
| nemotron-3.5-embed-8b@1024 | 97.7 | 100.0 | 91.7 | 2 / 0 |

### BEIR SciFact (300 queries, 5183 passages)

| Model @ dim | recall@5 | recall@10 | nDCG@10 | refused passages / queries |
|---|---:|---:|---:|---:|
| nemotron-3-embed-1b@2048 (current) | 80.5 | 86.4 | 74.9 | 0 / 0 |
| nemotron-3.5-embed-1b@2048 | 80.5 | 86.4 | 74.8 | 1 / 0 |
| nemotron-3.5-embed-1b@1024 | 79.7 | 85.8 | 74.5 | 1 / 0 |
| nemotron-3.5-embed-1b@512 | 78.6 | 84.3 | 71.4 | 1 / 0 |
| nemotron-3.5-embed-8b@4096 | 91.5 | 94.0 | 83.2 | 1 / 0 |
| **nemotron-3.5-embed-8b@2048 (chosen)** | **90.6** | **93.9** | **81.9** | 1 / 0 |
| nemotron-3.5-embed-8b@1024 | 88.9 | 93.0 | 80.4 | 1 / 0 |

### BEIR NFCorpus (323 queries, 3633 passages)

| Model @ dim | recall@5 | recall@10 | nDCG@10 | refused passages / queries |
|---|---:|---:|---:|---:|
| nemotron-3-embed-1b@2048 (current) | 14.1 | 17.7 | 36.9 | 0 / 0 |
| nemotron-3.5-embed-1b@2048 | 14.1 | 17.7 | 36.9 | 4 / 0 |
| nemotron-3.5-embed-1b@1024 | 13.3 | 17.3 | 35.9 | 4 / 0 |
| nemotron-3.5-embed-1b@512 | 12.7 | 16.4 | 34.5 | 4 / 0 |
| nemotron-3.5-embed-8b@4096 | 16.4 | 21.0 | 42.6 | 4 / 0 |
| **nemotron-3.5-embed-8b@2048 (chosen)** | **16.0** | **20.1** | **41.6** | 4 / 0 |
| nemotron-3.5-embed-8b@1024 | 14.7 | 18.9 | 38.7 | 4 / 0 |

NFCorpus has many relevant passages per query, so its absolute recall is low for every model; the relative order is
what it contributes.

### Latency

Single-query embedding, 20 sequential calls per model from the dev box to `integrate.api.nvidia.com`:

| Model | p50 ms | p95 ms |
|---|---:|---:|
| nemotron-3-embed-1b (current) | 380 | 397 |
| nemotron-3.5-embed-1b | 186 | 200 |
| nemotron-3.5-embed-8b | 248 | 269 |

Batch probe (passages of about 400 words): 1 input took 289 ms on 8b vs 391 ms on the current model; 64 inputs took
3387 ms vs 3924 ms. An earlier run the same day measured an 8b p95 of 1347 ms (one slow call in 20): that tail is the hosted queue, not
the model. The memory and knowledge read paths tolerate it, since they embed one query per request and fail open to
lexical ranking.

## Why 8b at 2048, not 4096 or 3.5-1b

- **3.5-1b is not an upgrade.** At 2048 it ties the current model to the decimal on all three sets, and it loses
  quality at every reduced dimension. On the hosted endpoint it also answered 500 "service inference failed" to any
  request with two or more non-trivial inputs, so it can only be driven one input per request.
- **8b at 2048 keeps 99% of the 4096 quality** (91.3 vs 92.2 nDCG@10 on docs, 81.9 vs 83.2 on SciFact) at half the
  storage, and it matches the stored dimension of the model it replaces, so the pgvector column and every jsonb
  reader keep working unchanged.
- **1024 is a real option** for later (docs 91.7, SciFact 80.4) if storage ever matters; it is not needed today.

## Content screening

Both nemotron-3.5 models screen inputs and refuse some with HTTP 422 "input rejected by content safety screening".
On the docs set they refused the agent-knowledge API section and a bash block from the agent-tokens guide; on the
BEIR sets, ordinary medical abstracts (disc nutrition, lumbar disc ageing, migraine triptans). These are false
positives, so the platform cannot assume every passage embeds in the new space. How production handles it:

- A refusal is a property of the input, not an outage: it surfaces as `code: 'content_refused'` and never puts the
  NIM lane into cooldown.
- `embedPassagesEach()` bisects a refused batch so only the refused text moves to the next lane (the previous
  model); every other text in the batch stays in the new space. Each row stores the tag of the model that embedded it.
- The re-embed keeps a refused row's existing vector when it is still servable, and backfills a row that had none.

So the refusal penalty applied in the tables above (refused passage = unretrievable) is worse than what users see.

## Score scale

Cosine scores shift slightly upward: the lowest score of a relevant docs passage is 0.23 on the current model and
0.26 on 8b. The agent-memory `minScore` of 0.25 still admits relevant memories, so no threshold changed.

## No cross-model comparison (mixed-model test output)

Both models produce 2048-dim vectors, so a vector length check can no longer tell their spaces apart; only the
`model@dim` tag can. Every vector row carries its tag, and every query is embedded with the model of the rows it is
compared against. These tests drive the real embeddings module against a stubbed NIM endpoint that returns
model-specific vectors, and they were written to fail before the change:

```
$ npx vitest run tests/embedding-spaces.test.js tests/memory-store.test.js tests/agent-embeddings-space.test.js --reporter=verbose
 ✓ tests/agent-embeddings-space.test.js > readAgentVectors > refuses to read without naming the model whose space the caller will query
 ✓ tests/agent-embeddings-space.test.js > readAgentVectors > filters the read by that model
 ✓ tests/embedding-spaces.test.js > the migration registry > defaults new ingest to nemotron-3.5-embed-8b and keeps the replaced model live behind it
 ✓ tests/embedding-spaces.test.js > the migration registry > asks NIM for the reduced Matryoshka dimension only on the model that supports it
 ✓ tests/embedding-spaces.test.js > scoreRowsBySpace with two same-dimension models > scores every row only against a query embedded by that row's own model
 ✓ tests/embedding-spaces.test.js > scoreRowsBySpace with two same-dimension models > never scores a row whose vector length contradicts its tag, and reports it for re-embedding
 ✓ tests/embedding-spaces.test.js > cosineInSpace > refuses to compare two vectors from different models even when their lengths match
 ✓ tests/embedding-spaces.test.js > content-safety refusals > surface as content_refused and do not put a healthy lane into cooldown
 ✓ tests/embedding-spaces.test.js > content-safety refusals > embedPassagesEach keeps every accepted text in the preferred space and moves only the refused one
 ✓ tests/embedding-spaces.test.js > content-safety refusals > strict mode throws on a lane outage instead of demoting the batch to the previous model
 ✓ tests/embedding-spaces.test.js > content-safety refusals > strict mode still moves a content refusal to the next lane
 ✓ tests/memory-store.test.js > ensureEmbeddings > stores each memory in the space that embedded it, so one refused memory never stalls the rest
 ✓ tests/memory-store.test.js > searchMemories > ranks by real cosine score and bumps access
 Test Files  3 passed (3)
      Tests  23 passed (23)
```

(Unrelated memory-store cases omitted from the listing; all 23 passed.)

## Migration with no retrieval gap

[scripts/nvidia-reembed.mjs](../../../scripts/nvidia-reembed.mjs) (`npm run nvidia:reembed`) moves stored vectors table
by table. Each row's UPDATE copies the old vector and tag into `embedding_prev` / `embedder_prev` and writes the new
pair, guarded by compare-and-swap on the row's tag and content. Because readers already score each row in its own
space, a half-migrated table serves new vectors where present and old ones elsewhere. A cursor per table in
`embedding_migrations` makes the run resumable and idempotent; `--status` shows progress, `--verify` runs a
known-item eval on production rows (new space vs old space), and `--restore` rolls a table back. The old vectors are
dropped only by a separate migration held in `api/_lib/migrations/held/` until verification passes.

The production run and its verification are recorded in [the run log below](#production-run).

## Production run

Run 2026-11-16 against the production database (Neon), shadow migration
`20261116193000_embedding_migration_shadow.sql` applied on its own with `--file`.

**Before:**

| table | rows | in target | pending | spaces |
|---|---:|---:|---:|---|
| agent_memories | 2961 | 0 | 2961 | 2779 no vector, 165 `nemotron-3-embed-1b@2048`, 17 retired `nv-embedqa-e5-v5@1024` |
| agent_knowledge_chunks | 11 | 0 | 11 | 11 `nemotron-3-embed-1b@2048` |
| widget_knowledge_chunks | 0 | 0 | 0 | |

**Run** (batch 16, 400 ms pause): agent_knowledge_chunks scanned 11, moved 11, cut over. agent_memories: a
`--limit 40` pass, then a resumed run from the saved cursor, reached 1512 scanned, 1512 moved, 0 refused, 0 skipped
(`--status`: "in progress", 1522 in target, 1439 pending, 103 old vectors kept in prev). No content refusals occurred
on production memories or knowledge.

**Verify on production rows** (`--verify`: each row's first ten words as a known-item query, ranked against every row
of the same agent in both spaces):

| table | queries | scopes | new space recall@1 | new space MRR | old space recall@1 | old space MRR |
|---|---:|---:|---:|---:|---:|---:|
| agent_memories | 85 | 2 | 84.7 | 90.0 | 83.5 | 89.3 |
| agent_knowledge_chunks | 11 | 1 | 100 | 100 | 100 | 100 |

The new space is at least as good on production data, which is all the cutover requires; production memories are
short and near-duplicate within an agent, so the docs and BEIR sets above carry the size of the win.

**Stopped and rolled back.** Mid-run the production service was found to be on commit `559f73663` (2026-11-15),
which predates the reader change. Its `scoreRowsBySpace` treats an unknown tag as an unconfigured space, so every row
moved into the 8b space dropped out of live semantic search until a deploy. The run was stopped, both tables were
restored with `--restore` (103 + 11 rows), and the 1419 memories that had no vector before the run were returned to
no vector. `--status` afterwards matches the "before" table exactly. Three fixes came out of it, each with a
reproducing test: a deploy gate (a writing run reads `/api/version` and refuses unless production contains the
reader commit), restore of rows that had no vector (an empty-string `embedder_prev` sentinel), and numeric cursor
order on bigint ids.

**Remaining step (owner):** after `three-ws-api` is deployed from a commit that contains `60128b5cc`, run
`npm run nvidia:reembed`, then `npm run nvidia:reembed -- --verify`. When every table reads "verified" in `--status`,
promote `api/_lib/migrations/held/20261116193100_drop_embedding_prev.sql`.
