# NIM release eval: `nvidia/nemotron-3.5-embed-8b`

Evaluated 2026-11-16T17:15:44.913Z by the day-0 lane eval (api/_lib/nim-lane-eval.js, run by api/cron/nim-release-eval.js or scripts/nvidia-lane-eval.mjs). Production config was not changed; any diff below is a proposal.

**Verdict: REJECT** for the embeddings lane

- recall@1 92% vs 100% today (-8 pts)
- p50 128 ms vs 215 ms
- worse than what runs today

## Classification

- Lane: embeddings (live); owner `nvidia`
- How: /v1/embeddings returned a 4096-dim vector
- Probe embeddings: ok HTTP 200 in 129 ms, "4096-dim vector"

## Results

Eval set: `data/evals/embeddings/v1.json` (v1, 12 items, CC0-1.0). Metric: recall@1.

| | Model | Quality | Format | Errors | p50 / p95 ms | Calls |
|---|---|---|---|---|---|---|
| Candidate | `nvidia/nemotron-3.5-embed-8b` | 92% | 100% | 0% | 128 / 257 | 36 |
| Today | `nvidia/nemotron-3-embed-1b` | 100% | 100% | 0% | 215 / 387 | 36 |

MRR: candidate 0.958, today 1. Dimension: candidate 4096, today 2048.

### Per item

| Item | Candidate | Today |
|---|---|---|
| q-rig | pass: rank 1 (top: p-rig) | pass: rank 1 (top: p-rig) |
| q-glb | pass: rank 1 (top: p-glb) | pass: rank 1 (top: p-glb) |
| q-lipsync | pass: rank 1 (top: p-lipsync) | pass: rank 1 (top: p-lipsync) |
| q-wallet | pass: rank 1 (top: p-wallet) | pass: rank 1 (top: p-wallet) |
| q-ratelimit | pass: rank 1 (top: p-ratelimit) | pass: rank 1 (top: p-ratelimit) |
| q-embed | pass: rank 1 (top: p-embed) | pass: rank 1 (top: p-embed) |
| q-coldstart | fail: rank 2 (top: p-coldstart-d) | pass: rank 1 (top: p-coldstart) |
| q-photo | pass: rank 1 (top: p-photo) | pass: rank 1 (top: p-photo) |
| q-lod | pass: rank 1 (top: p-lod) | pass: rank 1 (top: p-lod) |
| q-usd | pass: rank 1 (top: p-usd) | pass: rank 1 (top: p-usd) |
| q-tts | pass: rank 1 (top: p-tts) | pass: rank 1 (top: p-tts) |
| q-rerank | pass: rank 1 (top: p-rerank) | pass: rank 1 (top: p-rerank) |
