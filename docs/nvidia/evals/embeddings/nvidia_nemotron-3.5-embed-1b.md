# NIM release eval: `nvidia/nemotron-3.5-embed-1b`

Evaluated 2026-11-16T17:21:30.039Z by the day-0 lane eval (api/_lib/nim-lane-eval.js, run by api/cron/nim-release-eval.js or scripts/nvidia-lane-eval.mjs). Production config was not changed; any diff below is a proposal.

**Verdict: ADOPT** for the embeddings lane

- recall@1 100% vs 92% today (+8 pts)
- p50 120 ms vs 124 ms

## Classification

- Lane: embeddings (live); owner `nvidia`
- How: /v1/embeddings returned a 2048-dim vector
- Probe embeddings: ok HTTP 200 in 220 ms, "2048-dim vector"

## Results

Eval set: `data/evals/embeddings/v1.json` (v1, 12 items, CC0-1.0). Metric: recall@1.

| | Model | Quality | Format | Errors | p50 / p95 ms | Calls |
|---|---|---|---|---|---|---|
| Candidate | `nvidia/nemotron-3.5-embed-1b` | 100% | 100% | 0% | 120 / 230 | 36 |
| Today | `nvidia/nemotron-3.5-embed-8b` | 92% | 100% | 0% | 124 / 201 | 36 |

Today's model was called the way production calls it: {"dimensions":2048}.

MRR: candidate 1, today 0.958. Dimension: candidate 2048, today 2048.

### Per item

| Item | Candidate | Today |
|---|---|---|
| q-rig | pass: rank 1 (top: p-rig) | pass: rank 1 (top: p-rig) |
| q-glb | pass: rank 1 (top: p-glb) | pass: rank 1 (top: p-glb) |
| q-lipsync | pass: rank 1 (top: p-lipsync) | pass: rank 1 (top: p-lipsync) |
| q-wallet | pass: rank 1 (top: p-wallet) | pass: rank 1 (top: p-wallet) |
| q-ratelimit | pass: rank 1 (top: p-ratelimit) | pass: rank 1 (top: p-ratelimit) |
| q-embed | pass: rank 1 (top: p-embed) | pass: rank 1 (top: p-embed) |
| q-coldstart | pass: rank 1 (top: p-coldstart) | fail: rank 2 (top: p-coldstart-d) |
| q-photo | pass: rank 1 (top: p-photo) | pass: rank 1 (top: p-photo) |
| q-lod | pass: rank 1 (top: p-lod) | pass: rank 1 (top: p-lod) |
| q-usd | pass: rank 1 (top: p-usd) | pass: rank 1 (top: p-usd) |
| q-tts | pass: rank 1 (top: p-tts) | pass: rank 1 (top: p-tts) |
| q-rerank | pass: rank 1 (top: p-rerank) | pass: rank 1 (top: p-rerank) |

## Config diff to apply

Target: `api/_lib/embeddings.js`. Apply with `git apply`, run the lane's tests, deploy (owner gate), then verify on production before posting.

_Could not build the diff automatically (a previous re-pin is still in flight (NIM_EMBED_TAG_PREVIOUS is set); finish its re-embed and retire that tag first); wire nvidia/nemotron-3.5-embed-1b by hand in api/_lib/embeddings.js._

## Post draft

Post only after the diff is deployed and verified on production (owner approves and posts).

```text
Now live on three.ws: NVIDIA nemotron-3.5-embed-1b now embeds agent memory and knowledge-widget retrieval on three.ws.

100% recall@1 on our 12-task embeddings eval vs 92% for nemotron-3.5-embed-8b, which ran first until now, p50 120 ms on the free NIM endpoint.

[10 to 15 second clip: a knowledge widget answering from an uploaded document]

@NVIDIAAI @NVIDIAAIDev #NVIDIAInception
```
