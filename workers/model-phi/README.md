# model-phi

Microsoft Phi-4-mini-instruct, self-hosted on one Cloud Run L4 as a fast, low-cost brain lane for three.ws agents. Its main job is cheap internal work: memory summaries, triage and classification, and emote tags. Agents can also pick it by name in their brain settings.

- **Model:** [`microsoft/Phi-4-mini-instruct`](https://huggingface.co/microsoft/Phi-4-mini-instruct). It is 3.8B parameters with a 128k context (served at 32k) under the MIT license, pinned to revision `cfbefacb99257ffa30c83adab238a50856ac3083`.
- **Server:** the stock [vLLM](https://github.com/vllm-project/vllm) OpenAI-compatible image (`vllm/vllm-openai:v0.29.0`). This directory adds a tool-call parser plugin and a chat template that speak Phi's native tool format, so `/v1/chat/completions` returns structured `tool_calls`, both streamed and not.
- **Weights:** these are not baked into the image. `cloudbuild.weights.yaml` stages the pinned revision into `gs://three-ws-model-weights/phi-4-mini-instruct/`, checking every file's SHA-256 against the Hugging Face Hub record. It also writes `REVISION` and `MANIFEST.json`. At every boot, `serve.sh` checks the mounted tree against that manifest before vLLM reads a byte. A half-synced or re-pointed bucket fails the start instead of serving a different model.
- **Auth:** vLLM rejects any `/v1` request that lacks `Authorization: Bearer <key>`. The key is the GPU fleet's shared `avatar-reconstruction-key` secret, which the API already holds as `GCP_RECONSTRUCTION_KEY`. `GET /health` stays open for the startup probe.
- **Where:** Cloud Run service `model-phi` in `us-central1`, next to the weights bucket. It runs on one NVIDIA L4 with 8 vCPU and 32 GiB, and scales to zero (min 0, max 2, concurrency 32).

Measured cold start, time to first token, throughput, cost per 1,000 requests, the evaluation against the default chain, and the routing table are in [docs/phi-brain-lane.md](../../docs/phi-brain-lane.md).

## Files

| File | Role |
|---|---|
| `Dockerfile` | Pinned vLLM base plus the files below. Entrypoint is `serve.sh`. |
| `serve.sh` | Checks the staged weights against `MANIFEST.json`, then starts `vllm serve` with the tool parser, the chat template, prefix caching, 32k context and 64 sequences. |
| `phi_tool_format.py` | Pure parsing of Phi's `<|tool_call|>[...]` output (and the older `functools[...]` form) into OpenAI tool calls. |
| `phi_tool_parser.py` | The vLLM `ToolParser` plugin (`phi4_mini_native`) that wraps it for streamed and non-streamed responses. |
| `chat_template.jinja` | Renders offered tools, assistant tool calls and tool results in Phi's native turn format, so multi-turn tool loops replay correctly. |
| `stage_weights.py`, `cloudbuild.weights.yaml` | One-time, checksummed weight staging into the bucket. |
| `cloudbuild.yaml` | Builds the image and deploys the scale-to-zero service. |
| `bench.py`, `bench_job.sh`, `cloudbuild.verify.yaml` | The verification run: the same server as a Cloud Run GPU job that measures the numbers and answers the evaluation tasks. |
| `test_phi_tool_format.py` | Unit tests for the tool-call parsing (`python3 -m pytest workers/model-phi -q`). |

## Deploy

Stage the weights once (re-runs exit early when `REVISION` matches):

```bash
gcloud builds submit --config workers/model-phi/cloudbuild.weights.yaml \
  --project aerial-vehicle-466722-p5 workers/model-phi
```

Deploy the service:

```bash
gcloud builds submit --config workers/model-phi/cloudbuild.yaml \
  --project aerial-vehicle-466722-p5 workers/model-phi
```

Point the API at it. The lane stays dormant until `PHI_WORKER_URL` is set:

```bash
URL=$(gcloud run services describe model-phi --region us-central1 \
  --project aerial-vehicle-466722-p5 --format='value(status.url)')
gcloud run services update three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 --update-env-vars PHI_WORKER_URL=$URL
```

## Verify without a long-lived service

```bash
node scripts/phi-brain-eval.mjs build --dir /tmp/phi-eval      # tasks.json, uploaded to the results bucket
gcloud builds submit --config workers/model-phi/cloudbuild.verify.yaml \
  --project aerial-vehicle-466722-p5 \
  --substitutions=_RUN_ID=$(date -u +%Y%m%dT%H%M%SZ) workers/model-phi
```

The job boots `serve.sh` exactly as the service would and records container start to `/health` as the cold start. It then checks plain chat, streaming, a tool call and a tool follow-up turn, and measures time to first token and throughput at several concurrency levels. It also answers every evaluation task. Everything lands in `gs://three-ws-avatar-reconstructions/verify/phi/<run>/report.json`, and the job scales to zero when it exits. The rest of the evaluation (baseline, judge, report) is in [docs/phi-brain-lane.md](../../docs/phi-brain-lane.md#re-running-the-evaluation).

## API env

| Variable | Meaning |
|---|---|
| `PHI_WORKER_URL` | Base URL of this service (with or without `/v1`). Setting it turns the lane on. |
| `PHI_WORKER_KEY` | Bearer key. Optional: falls back to `GCP_RECONSTRUCTION_KEY`. |
| `PHI_TIMEOUT_MS` | Per-call timeout before the chain falls back. Default `10000`. |
| `PHI_ROUTED_TASKS` | Comma-separated task types to route to Phi, overriding the evaluated default in `api/_lib/phi-lane.js`. |

## Calling it directly

```bash
curl -s "$URL/v1/chat/completions" \
  -H "authorization: Bearer $GCP_RECONSTRUCTION_KEY" \
  -H 'content-type: application/json' \
  -d '{"model":"microsoft/Phi-4-mini-instruct","messages":[{"role":"user","content":"Summarize: the user asked for a 3D chair and liked the oak one."}],"max_tokens":80}'
```

Add `"stream": true` for server-sent events, or `"tools": [...]` for function calling. Tool calls come back in `choices[0].message.tool_calls` with `finish_reason: "tool_calls"`.
