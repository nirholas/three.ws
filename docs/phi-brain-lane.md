# Phi brain lane

three.ws self-hosts Microsoft's Phi small language model on its own Google Cloud GPU fleet as an optional agent brain lane. The lane is built, verified on a real L4 and wired into the platform's LLM layer. Agents and internal callers can pick it by name. The evaluation below decides which internal task types it serves by default, and today that list is empty: Phi-4-mini did not meet the quality bar on any of them.

## At a glance

| | |
|---|---|
| Model | [`microsoft/Phi-4-mini-instruct`](https://huggingface.co/microsoft/Phi-4-mini-instruct), 3.8B parameters, 128k context (served at 32k), revision `cfbefacb99257ffa30c83adab238a50856ac3083` |
| License | MIT (read from the staged `LICENSE` in `gs://three-ws-model-weights/phi-4-mini-instruct/`) |
| Server | vLLM `v0.29.0` (Apache-2.0), OpenAI-compatible `/v1/chat/completions` with streaming and tool calling, plus our Phi-native tool parser and chat template |
| Worker | [`workers/model-phi/`](../workers/model-phi/README.md): Cloud Run, one NVIDIA L4, 8 vCPU, 32 GiB, min 0, max 2, concurrency 32 |
| API adapter | [`api/_lib/phi-lane.js`](../api/_lib/phi-lane.js), wired into [`api/_lib/llm.js`](../api/_lib/llm.js) and [`api/_lib/llm-tool-chain.js`](../api/_lib/llm-tool-chain.js) |
| Switch | Dormant until `PHI_WORKER_URL` is set on the API service |
| Default routing | None (see [Routing table](#routing-table)) |

## How it fits the LLM layer

- **By name.** The tool loop serves the worker as the catalog model `microsoft/Phi-4-mini-instruct`, so an agent owner can choose Phi in brain settings. Internal callers pass `preferPhi: true` to `llmComplete` to lead with it.
- **By task type.** Callers tag their request with a `task`. `feedback_triage` ([api/_lib/feedback/triage.js](../api/_lib/feedback/triage.js)), `bounty_triage` ([api/_lib/bounties/triage.js](../api/_lib/bounties/triage.js)) and `memory_summary` ([api/agent-reflect-digest.js](../api/agent-reflect-digest.js)) already do. A tagged type goes to Phi first only when it is in `PHI_ROUTED_TASKS` (the evaluated default in `phi-lane.js`, overridable by env without a deploy).
- **Fallback.** Any timeout (default 10 s, `PHI_TIMEOUT_MS`), connection failure or HTTP error falls through to the normal free-first provider chain, logged as `[llm] phi lane fell back to <provider>` (or `[phi] ... falling back` in the tool loop). After a stall or 5xx the lane sits out for 90 s, about one GPU cold start, so requests during a scale-from-zero boot go straight to the chain.
- **Tool calls.** Phi-4-mini writes tool calls as `<|tool_call|>[...]` text. The worker's vLLM parser plugin and the API's `normalizePhiRound` both turn that into structured `tool_calls`, repairing the bracket slips the model makes inside a marked block. Unmarked JSON is deliberately left as text, because it can be a legitimate JSON answer.

## Measured on GCP

Verification job run `20261112T174111Z`: the production image, booted by the same `serve.sh` the service uses, as a Cloud Run GPU job in us-central1 on one L4 (`cloudbuild.verify.yaml`). Raw report: `gs://three-ws-avatar-reconstructions/verify/phi/20261112T174111Z/report.json`.

| Check | Result |
|---|---|
| Cold start (container start to `/health` OK, includes checksum-verifying the weights from GCS and vLLM warmup) | 283 s |
| Plain chat ("capital of Norway") | "Oslo", 0.13 s |
| Streaming, 320 tokens | first token 0.14 s, 31.9 tokens/s decode for one stream |
| Tool call, non-streamed | `get_weather {"city":"Oslo","unit":"celsius"}`, `finish_reason: tool_calls`, 0.89 s |
| Tool call, streamed | same call assembled from the stream, first token 0.88 s |
| Tool follow-up turn (tool result in, answer out) | "The current weather in Oslo is 4 degrees Celsius with light snow.", 0.51 s |
| GPU memory | 19.8 of 23.0 GiB used (weights plus KV cache at 32k context, 64 sequences) |

Throughput, with the evaluation prompts as the workload (mean 540 to 725 prompt tokens, 57 to 71 output tokens):

| Concurrency | Requests | Errors | Requests/s | Output tokens/s | Latency p50 / p95 | Time to first token p50 / p95 |
|---|---|---|---|---|---|---|
| 1 | 24 | 0 | 0.53 | 30 | 1.75 s / 2.97 s | 0.08 s / 0.13 s |
| 8 | 24 | 0 | 3.03 | 172 | 1.98 s / 2.61 s | 0.10 s / 0.11 s |
| 16 | 48 | 0 | 3.30 | 236 | 3.23 s / 4.51 s | 0.13 s / 0.30 s |
| 32 | 96 | 0 | 5.92 | 363 | 2.63 s / 7.16 s | 0.17 s / 1.39 s |

### Cost per 1,000 requests

Cloud Run instance-based billing at us-central1 list prices: L4 without zonal redundancy $0.0001867/s, 8 vCPU at $0.000018/vCPU-s, 32 GiB at $0.000002/GiB-s, about **$0.000395 per instance-second ($1.42 per hour)**, paid from the GCP credits.

| Load | Seconds per 1,000 requests | Cost per 1,000 requests |
|---|---|---|
| Saturated (concurrency 32) | 169 | $0.067 |
| Busy (concurrency 8) | 330 | $0.130 |
| Serial (concurrency 1) | 1,873 | $0.74 |
| Each cold start | 283 per boot | $0.11 per boot |

For scale: the same request mix (584 prompt and 57 output tokens on average) on Gemini 2.5 Flash, the chain's Vertex anchor, is about $0.32 per 1,000 requests at $0.30 and $2.50 per million tokens. So Phi costs less only when traffic keeps the instance busy. A scale-to-zero instance woken for a trickle of requests also pays the boot and the idle window before Cloud Run scales it down, which costs more than the requests themselves.

## Evaluation

91 tasks, built by [`scripts/phi-brain-eval.mjs`](../scripts/phi-brain-eval.mjs) `build` from real, anonymized platform data with the production prompt builders, so each prompt is byte-for-byte what its caller would send:

| Task type | Tasks | Source | Scored by |
|---|---|---|---|
| `feedback_triage` | 30 | real feedback reports | kind matches the judge's blind label (60%) and severity within 20 (40%) |
| `bounty_triage` | 15 | real bounty listings | category matches (60%) and effort matches (40%) |
| `memory_summary` | 10 | real agent memories to diary paragraph | judge rubric: grounding, coverage, form, 1 to 5 each |
| `agent_tools` | 12 | the repo's eval suites (`evals/suites/*.json`), first tool round | the suite's own checks via `api/_lib/evals/checks.js` |
| `emote_actions` | 24 | real widget openers and action asks against `api/chat.js` tools | right tool with matching arguments, or no non-emote tool when none is wanted |

- **Phi:** answers from the GPU run above, 0 errors.
- **Baseline:** the current default chain as production serves it on 2026-11-16. Groq's two lead rungs had spent their daily token caps (qwen3.8-27b 429, gpt-oss-120b at 199,925 of 200,000 tokens), so the chain falls through to the NVIDIA rung `nvidia/nemotron-3.5-lightning-30b-a3b`, which answered all 91 tasks with 0 errors.
- **Judge:** `nvidia/nemotron-3-ultra-550b-a55b`, a third and much larger model. It labels the classifier tasks blind to both candidates and grades the diary paragraphs blind to who wrote them. 45 references and 20 rubric grades, 0 errors.
- **Bar:** a task type is routed to Phi when its score is within 5 points (on 0 to 100) of the baseline and at least 95% of its outputs parse.

| Task type | Tasks | Baseline score | Phi score | Gap (pts) | Phi parse validity | Baseline p50 s | Phi p50 s | Route to Phi |
|---|---|---|---|---|---|---|---|---|
| feedback_triage | 30 | 48.7 | 30.7 | 18.0 | 97% | 0.78 | 2.14 | no |
| bounty_triage | 15 | 33.3 | 18.7 | 14.7 | 60% | 1.08 | 3.33 | no |
| memory_summary | 10 | 92.0 | 81.3 | 10.7 | 100% | 1.54 | 6.11 | no |
| agent_tools | 12 | 12.5 | 4.2 | 8.3 | 100% | 0.57 | 1.18 | no |
| emote_actions | 24 | 95.8 | 58.3 | 37.5 | 100% | 0.42 | 1.12 | no |
| all | 91 | 58.6 | 38.1 | 20.5 | | | | |

The p50 columns are not a like-for-like latency comparison. Phi answered all 91 tasks at 16 parallel requests on one L4, and the baseline ran 3 at a time against NVIDIA's hosted fleet. Phi's own unloaded latency is in the throughput table above.

### Why Phi missed on each type

- **emote_actions (gap 37.5).** Phi left out required arguments (`setWireframe {}` instead of `{"value": true}`, and the same for `setGrid` and `setAutoRotate`). On 5 of 24 tasks it wrote the call as bare JSON text instead of a tool call. On greetings it sometimes called an unrelated tool (`loadModel {}`). Rescoring with the production tool-loop repair applied changes nothing, because unmarked JSON is not repaired by design. Even crediting all five bare-JSON answers would leave a gap of about 17 points.
- **bounty_triage (gap 14.7, 60% valid).** Phi invented a `hackathon` category that is not in the allowed enum on 6 of 15 listings, so its output is rejected by `parseTriage` exactly as production would reject it.
- **feedback_triage (gap 18.0).** Output parses (97%), but kind and severity agree with the judge much less often than the baseline's do.
- **memory_summary (gap 10.7).** Readable diary paragraphs, graded lower on grounding and coverage.
- **agent_tools (gap 8.3).** Both models score low on this first-round slice, which only credits tool choice. Phi still trails.

One caveat: the baseline and the judge are both Nemotron models, which may favor the baseline on the classifier labels. That bias cannot explain the emote and bounty results, though, which are scored against fixed expectations and the production parser rather than the judge.

Files: `gs://three-ws-avatar-reconstructions/verify/phi/eval-20261116/` holds `baseline.json`, `judge.json` and `verdict-20261112T174111Z.json`. Task data and answers are real user text, so only this aggregate table is committed.

## Routing table

| Task type | Routed to Phi by default | Reason |
|---|---|---|
| feedback_triage | no | 18.0 points below the default chain |
| bounty_triage | no | 14.7 points below, 60% parseable |
| memory_summary | no | 10.7 points below |
| agent_tools | no | 8.3 points below |
| emote_actions | no | 37.5 points below; drops required tool arguments |

`PHI_ROUTED_TASKS` in [`api/_lib/phi-lane.js`](../api/_lib/phi-lane.js) is therefore empty. With `PHI_WORKER_URL` set, Phi serves only callers that ask for it: an agent that picks `microsoft/Phi-4-mini-instruct` by name, or an internal call with `preferPhi: true`. Each of those still falls back to the chain on error or timeout. The env var `PHI_ROUTED_TASKS=memory_summary,...` turns a type on without a deploy if a later evaluation (a newer Phi checkpoint, a tuned prompt) clears the bar.

## Re-running the evaluation

```bash
node --env-file=.env.local scripts/phi-brain-eval.mjs build --dir /tmp/phi-eval   # read-only DB pass, uploads tasks.json
gcloud builds submit --config workers/model-phi/cloudbuild.verify.yaml \
  --project aerial-vehicle-466722-p5 \
  --substitutions=_RUN_ID=$(date -u +%Y%m%dT%H%M%SZ) workers/model-phi   # Phi answers + latency numbers
node scripts/phi-brain-eval.mjs baseline --dir /tmp/phi-eval --baseline groq   # or groq#120b, or nvidia when Groq's daily caps are spent
node scripts/phi-brain-eval.mjs judge --dir /tmp/phi-eval --phi <run-id>
node scripts/phi-brain-eval.mjs report --dir /tmp/phi-eval --phi <run-id>
```

`report` prints the table above and writes `verdict-<run-id>.json`. Move a task type into `PHI_ROUTED_TASKS` only when its row says `yes`.

## Related

- Worker, deploy and env: [workers/model-phi/README.md](../workers/model-phi/README.md)
- Microsoft open source in the stack: [docs/microsoft.md](./microsoft.md)
- LLM provider policy: header of [api/_lib/llm.js](../api/_lib/llm.js)
