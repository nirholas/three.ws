# Day-0 pipeline run: `nvidia/nemotron-3.5-bolt-e4b`

Run 2026-11-16T17:21:13.551Z with `node scripts/nvidia-lane-eval.mjs --pipeline nvidia/nemotron-3.5-bolt-e4b`.
Live NIM catalog and live model calls; the queue and result rows lived in a throwaway in-process Postgres built from the production schema plus every migration (scripts/lib/isolated-db.mjs), not the production database.

## What ran

1. `watchNvidiaReleases` (api/cron/free-model-audit.js) listed the live catalog (33 ids) against a snapshot without `nvidia/nemotron-3.5-bolt-e4b`, saw it as new (status `new`) and enqueued it: queued ["nvidia/nemotron-3.5-bolt-e4b"].
2. `runNextReleaseEval` (api/cron/nim-release-eval.js) claimed row 1, evaluated it and stored the result: status `done`, lane `vision`, verdict `adopt`, attempts 1.
3. Queue after the run: done 1.

## Stored row

| Column | Value |
|---|---|
| id | 1 |
| model_id | nvidia/nemotron-3.5-bolt-e4b |
| owned_by | nvidia |
| source | catalog-watch |
| status | done |
| attempts | 1 |
| lane | vision |
| verdict | adopt |
| created_at | 2026-11-16T17:21:02.449Z |
| started_at | 2026-11-16T17:21:02.481Z |
| completed_at | 2026-11-16T17:21:13.523Z |
| config_diff | 548 chars |
| post_draft | 444 chars |
| report_md | 3109 chars |

## Ops alerts sent

### 🆕 1 new model(s) on NVIDIA NIM

Signature `llm:nim-new-release`.

```text
NVIDIA releases:
  nvidia/nemotron-3.5-bolt-e4b
Queued 1 lane evaluation(s); the verdict, report, config diff and post draft follow in a separate alert per model.
Wire the relevant one today and post it tagging @NVIDIAAIDev: day-0 adoption is what NVIDIA reshares. Runbook: docs/nvidia-visibility-map.md#day-0-adoption-the-route-to-an-nvidia-repost
```

### NIM release eval: nvidia/nemotron-3.5-bolt-e4b ADOPT (vision lane)

Signature `llm:nim-release-eval:nvidia/nemotron-3.5-bolt-e4b`.

```text
- accuracy 86% vs 79% today (+7 pts)
- p50 588 ms vs 889 ms
Candidate: quality 86%, format 100%, errors 0%, p50/p95 588/841 ms
Today (nvidia/nemotron-3.5-super-vl-120b-a12b): quality 79%, errors 0%, p50 889 ms
Report: https://three.ws/admin/nim-releases?model=nvidia%2Fnemotron-3.5-bolt-e4b

Config diff (api/_lib/vision.js), not applied:
===================================================================
--- a/api/_lib/vision.js
+++ b/api/_lib/vision.js
@@ -63,6 +63,7 @@
 // request that cannot wait for it falls straight through to the OpenRouter
 // routes below.
 export const NVIDIA_VISION_MODELS = [
+	{ model: 'nvidia/nemotron-3.5-bolt-e4b', extraBody: { chat_template_kwargs: { enable_thinking: false } } },
 	{ model: 'nvidia/nemotron-3.5-super-vl-120b-a12b', extraBody: { chat_template_kwargs: { enable_thinking: false } } },
 ];
 // Free OpenRouter vision lanes, in order.

Post draft (post only after the diff is deployed and verified):
Live on three.ws the day it shipped: NVIDIA nemotron-3.5-bolt-e4b is how three.ws sees images: it screens Forge photo uploads, checks generated models and writes avatar alt text.

86% accuracy on our 14-task vision eval vs 79% for nemotron-3.5-super-vl-120b-a12b, which ran first until now, p50 588 ms on the free NIM endpoint.

[10 to 15 second clip: a Forge photo upload getting its pre-check verdict]

@NVIDIAAI @NVIDIAAIDev #NVIDIAInception
```

## Stored report (report_md)

### NIM release eval: `nvidia/nemotron-3.5-bolt-e4b`

Evaluated 2026-11-16T17:21:02.497Z by the day-0 lane eval (api/_lib/nim-lane-eval.js, run by api/cron/nim-release-eval.js or scripts/nvidia-lane-eval.mjs). Production config was not changed; any diff below is a proposal.

**Verdict: ADOPT** for the vision lane

- accuracy 86% vs 79% today (+7 pts)
- p50 588 ms vs 889 ms

## Classification

- Lane: vision (live); owner `nvidia`
- How: chat answered with an image input and named the colour drawn in it
- Probe embeddings: failed HTTP 404 in 39 ms, HTTP 404: 404 page not found
- Probe chat: ok HTTP 200 in 251 ms, "ok"
- Probe vision: ok HTTP 200 in 735 ms, "Red"

## Results

Eval set: `data/evals/vision/v1.json` (v1, 14 items, CC0-1.0). Metric: accuracy.

| | Model | Quality | Format | Errors | p50 / p95 ms | Calls |
|---|---|---|---|---|---|---|
| Candidate | `nvidia/nemotron-3.5-bolt-e4b` | 86% | 100% | 0% | 588 / 841 | 14 |
| Today | `nvidia/nemotron-3.5-super-vl-120b-a12b` | 79% | 79% | 0% | 889 / 4392 | 14 |

### Per item

| Item | Candidate | Today |
|---|---|---|
| colour-1 | pass: Red | pass: red |
| colour-2 | pass: Blue | pass: blue |
| colour-3 | pass: black | pass: Black |
| shape-1 | pass: Triangle | pass: triangle |
| shape-2 | pass: 5 | fail (format): The user wants me to count the sides of the shape in the ima |
| count-1 | pass: 3 | pass: 3 |
| count-2 | fail: 7 | fail (format): The user wants me to count the squares in the image.  1.  ** |
| count-3 | fail: 8 | fail (format): The user wants me to count the dots in the image.  1.  **Ana |
| digits-1 | pass: 47 | pass: 47 |
| digits-2 | pass: 305 | pass: 305 |
| position-1 | pass: left | pass: left |
| position-2 | pass: Vertical | pass: vertical |
| direction-1 | pass: up | pass: up |
| compare-1 | pass: Red | pass: red |

## Config diff to apply

Target: `api/_lib/vision.js`. Apply with `git apply`, run the lane's tests, deploy (owner gate), then verify on production before posting.

```diff
===================================================================
--- a/api/_lib/vision.js
+++ b/api/_lib/vision.js
@@ -63,6 +63,7 @@
 // request that cannot wait for it falls straight through to the OpenRouter
 // routes below.
 export const NVIDIA_VISION_MODELS = [
+	{ model: 'nvidia/nemotron-3.5-bolt-e4b', extraBody: { chat_template_kwargs: { enable_thinking: false } } },
 	{ model: 'nvidia/nemotron-3.5-super-vl-120b-a12b', extraBody: { chat_template_kwargs: { enable_thinking: false } } },
 ];
 // Free OpenRouter vision lanes, in order.
```

## Post draft

Post only after the diff is deployed and verified on production (owner approves and posts).

```text
Live on three.ws the day it shipped: NVIDIA nemotron-3.5-bolt-e4b is how three.ws sees images: it screens Forge photo uploads, checks generated models and writes avatar alt text.

86% accuracy on our 14-task vision eval vs 79% for nemotron-3.5-super-vl-120b-a12b, which ran first until now, p50 588 ms on the free NIM endpoint.

[10 to 15 second clip: a Forge photo upload getting its pre-check verdict]

@NVIDIAAI @NVIDIAAIDev #NVIDIAInception
```
