# NIM release eval: `nvidia/nemotron-3.5-super-vl-120b-a12b`

Evaluated 2026-11-16T17:15:00.343Z by the day-0 lane eval (api/_lib/nim-lane-eval.js, run by api/cron/nim-release-eval.js or scripts/nvidia-lane-eval.mjs). Production config was not changed; any diff below is a proposal.

**Verdict: REJECT** for the vision lane

- nvidia/nemotron-3.5-super-vl-120b-a12b is already the first vision rung, so this run is a baseline of production scored against the lane floor
- format adherence 79% is under 80%

## Classification

- Lane: vision (live); owner `nvidia`
- How: chat answered with an image input and named the colour drawn in it
- Probe embeddings: failed HTTP 404 in 172 ms, HTTP 404: 404 page not found
- Probe chat: ok HTTP 200 in 261 ms, "ok"
- Probe vision: ok HTTP 200 in 884 ms, "Red"

## Results

Eval set: `data/evals/vision/v1.json` (v1, 14 items, CC0-1.0). Metric: accuracy.

| | Model | Quality | Format | Errors | p50 / p95 ms | Calls |
|---|---|---|---|---|---|---|
| Candidate | `nvidia/nemotron-3.5-super-vl-120b-a12b` | 79% | 79% | 0% | 1025 / 38886 | 14 |
| Today | n/a | n/a | n/a | n/a | n/a | n/a |

### Per item

| Item | Candidate | Today |
|---|---|---|
| colour-1 | pass: red | n/a |
| colour-2 | pass: blue | n/a |
| colour-3 | pass: Black | n/a |
| shape-1 | pass: triangle | n/a |
| shape-2 | fail (format): The user wants me to count the sides of the shape in the ima | n/a |
| count-1 | pass: 3 | n/a |
| count-2 | fail (format): The user wants me to count the squares in the image.  1.  ** | n/a |
| count-3 | fail (format): The user wants me to count the dots in the image.  1.  **Ana | n/a |
| digits-1 | pass: 47 | n/a |
| digits-2 | pass: 305 | n/a |
| position-1 | pass: left | n/a |
| position-2 | pass: vertical | n/a |
| direction-1 | pass: up | n/a |
| compare-1 | pass: red | n/a |
