# NIM release eval: `nvidia/nemotron-3.5-embed-8b`

Evaluated 2026-11-16T17:21:32.921Z by the day-0 lane eval (api/_lib/nim-lane-eval.js, run by api/cron/nim-release-eval.js or scripts/nvidia-lane-eval.mjs). Production config was not changed; any diff below is a proposal.

**Verdict: ADOPT** for the embeddings lane

- nvidia/nemotron-3.5-embed-8b is already the first embeddings rung, so this run is a baseline of production scored against the lane floor
- candidate clears the floor: recall@1 92%

## Classification

- Lane: embeddings (live); owner `nvidia`
- How: /v1/embeddings returned a 4096-dim vector
- Probe embeddings: ok HTTP 200 in 126 ms, "4096-dim vector"

## Results

Eval set: `data/evals/embeddings/v1.json` (v1, 12 items, CC0-1.0). Metric: recall@1.

| | Model | Quality | Format | Errors | p50 / p95 ms | Calls |
|---|---|---|---|---|---|---|
| Candidate | `nvidia/nemotron-3.5-embed-8b` | 92% | 100% | 0% | 124 / 152 | 36 |
| Today | n/a | n/a | n/a | n/a | n/a | n/a |

MRR: candidate 0.958. Dimension: candidate 2048.

### Per item

| Item | Candidate | Today |
|---|---|---|
| q-rig | pass: rank 1 (top: p-rig) | n/a |
| q-glb | pass: rank 1 (top: p-glb) | n/a |
| q-lipsync | pass: rank 1 (top: p-lipsync) | n/a |
| q-wallet | pass: rank 1 (top: p-wallet) | n/a |
| q-ratelimit | pass: rank 1 (top: p-ratelimit) | n/a |
| q-embed | pass: rank 1 (top: p-embed) | n/a |
| q-coldstart | fail: rank 2 (top: p-coldstart-d) | n/a |
| q-photo | pass: rank 1 (top: p-photo) | n/a |
| q-lod | pass: rank 1 (top: p-lod) | n/a |
| q-usd | pass: rank 1 (top: p-usd) | n/a |
| q-tts | pass: rank 1 (top: p-tts) | n/a |
| q-rerank | pass: rank 1 (top: p-rerank) | n/a |

## Config diff to apply

Target: `api/_lib/embeddings.js`. Apply with `git apply`, run the lane's tests, deploy (owner gate), then verify on production before posting.

_nvidia/nemotron-3.5-embed-8b is already the first embeddings rung in api/_lib/embeddings.js; nothing to apply._

## Post draft

Post only after the diff is deployed and verified on production (owner approves and posts).

```text
Now live on three.ws: NVIDIA nemotron-3.5-embed-8b now embeds agent memory and knowledge-widget retrieval on three.ws.

92% recall@1 on our 12-task embeddings eval, p50 124 ms on the free NIM endpoint.

[10 to 15 second clip: a knowledge widget answering from an uploaded document]

@NVIDIAAI @NVIDIAAIDev #NVIDIAInception
```
