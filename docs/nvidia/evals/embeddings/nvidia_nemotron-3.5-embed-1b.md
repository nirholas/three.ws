# NIM release eval: `nvidia/nemotron-3.5-embed-1b`

Evaluated 2026-11-16T17:15:40.731Z by the day-0 lane eval (api/_lib/nim-lane-eval.js, run by api/cron/nim-release-eval.js or scripts/nvidia-lane-eval.mjs). Production config was not changed; any diff below is a proposal.

**Verdict: ADOPT** for the embeddings lane

- recall@1 100% vs 100% today (+0 pts)
- p50 126 ms vs 218 ms
- quality holds and latency is within 25%

## Classification

- Lane: embeddings (live); owner `nvidia`
- How: /v1/embeddings returned a 2048-dim vector
- Probe embeddings: ok HTTP 200 in 189 ms, "2048-dim vector"

## Results

Eval set: `data/evals/embeddings/v1.json` (v1, 12 items, CC0-1.0). Metric: recall@1.

| | Model | Quality | Format | Errors | p50 / p95 ms | Calls |
|---|---|---|---|---|---|---|
| Candidate | `nvidia/nemotron-3.5-embed-1b` | 100% | 100% | 0% | 126 / 228 | 36 |
| Today | `nvidia/nemotron-3-embed-1b` | 100% | 100% | 0% | 218 / 389 | 36 |

MRR: candidate 1, today 1. Dimension: candidate 2048, today 2048.

### Per item

| Item | Candidate | Today |
|---|---|---|
| q-rig | pass: rank 1 (top: p-rig) | pass: rank 1 (top: p-rig) |
| q-glb | pass: rank 1 (top: p-glb) | pass: rank 1 (top: p-glb) |
| q-lipsync | pass: rank 1 (top: p-lipsync) | pass: rank 1 (top: p-lipsync) |
| q-wallet | pass: rank 1 (top: p-wallet) | pass: rank 1 (top: p-wallet) |
| q-ratelimit | pass: rank 1 (top: p-ratelimit) | pass: rank 1 (top: p-ratelimit) |
| q-embed | pass: rank 1 (top: p-embed) | pass: rank 1 (top: p-embed) |
| q-coldstart | pass: rank 1 (top: p-coldstart) | pass: rank 1 (top: p-coldstart) |
| q-photo | pass: rank 1 (top: p-photo) | pass: rank 1 (top: p-photo) |
| q-lod | pass: rank 1 (top: p-lod) | pass: rank 1 (top: p-lod) |
| q-usd | pass: rank 1 (top: p-usd) | pass: rank 1 (top: p-usd) |
| q-tts | pass: rank 1 (top: p-tts) | pass: rank 1 (top: p-tts) |
| q-rerank | pass: rank 1 (top: p-rerank) | pass: rank 1 (top: p-rerank) |

## Config diff to apply

Target: `api/_lib/embeddings.js`. Apply with `git apply`, run the lane's tests, deploy (owner gate), then verify on production before posting.

```diff
===================================================================
--- a/api/_lib/embeddings.js
+++ b/api/_lib/embeddings.js
@@ -59,7 +59,10 @@
 // reached end of life on 2026-08-25 and began answering every call with a
 // 410 Gone, which took the free ingest lane out silently. Re-pinned 2026-09-10
 // from GET /v1/models, dimension measured from a live call rather than assumed.
-export const NIM_EMBED_TAG = 'nvidia/nemotron-3-embed-1b@2048';
+export const NIM_EMBED_TAG = 'nvidia/nemotron-3.5-embed-1b@2048';
+// The embedder this tag replaced: rows written before the re-pin carry it,
+// so it stays resolvable and stays the ingest rung behind the new one.
+export const NIM_EMBED_TAG_PREVIOUS = 'nvidia/nemotron-3-embed-1b@2048';
 // The retired NIM embedder. Rows embedded before 2026-09-10 carry this tag and
 // resolve through it forever: like LEGACY_EMBED_TAG below, this must never be
 // removed even though nothing new is written with it. It is deliberately absent
@@ -78,6 +81,14 @@
 	[NIM_EMBED_TAG]: Object.freeze({
 		tag: NIM_EMBED_TAG,
 		provider: 'nim',
+		model: 'nvidia/nemotron-3.5-embed-1b',
+		dim: 2048,
+		free: true,
+		configured: () => !!process.env.NVIDIA_API_KEY,
+	}),
+	[NIM_EMBED_TAG_PREVIOUS]: Object.freeze({
+		tag: NIM_EMBED_TAG_PREVIOUS,
+		provider: 'nim',
 		model: 'nvidia/nemotron-3-embed-1b',
 		dim: 2048,
 		free: true,
@@ -118,7 +129,7 @@
 
 // Free lane first, then the credit-funded Vertex lane (no vendor quota to
 // exhaust), OpenAI as the true last-resort paid backstop.
-const INGEST_PREFERENCE = Object.freeze([NIM_EMBED_TAG, VERTEX_EMBED_TAG, OPENAI_EMBED_TAG]);
+const INGEST_PREFERENCE = Object.freeze([NIM_EMBED_TAG, NIM_EMBED_TAG_PREVIOUS, VERTEX_EMBED_TAG, OPENAI_EMBED_TAG]);
 
 /** True when at least one embedding provider can actually serve. */
 export function embeddingsConfigured() {
```

## Post draft

Post only after the diff is deployed and verified on production (owner approves and posts).

```text
Now live on three.ws: NVIDIA nemotron-3.5-embed-1b now embeds agent memory and knowledge-widget retrieval on three.ws.

100% recall@1 on our 12-task embeddings eval vs 100% for nemotron-3-embed-1b, the model it replaces, p50 126 ms on the free NIM endpoint.

[10 to 15 second clip: a knowledge widget answering from an uploaded document]

@NVIDIAAI @NVIDIAAIDev #NVIDIAInception
```
