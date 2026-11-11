# microsoft 18: self-host Microsoft Phi on the GCP GPU fleet as a fast, low-cost agent brain lane

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3118.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Many agent calls do not need a frontier model: summarizing a chat into memory, classifying intent, writing an emote tag, routing a request, chatting on the free tier. Microsoft's Phi small language models are MIT-licensed open weights built for exactly that, and they run well on a single L4 GPU. Self-hosting Phi on the GCP credits (pre-approved) cuts third-party LLM spend, removes a dependency during provider outages, and adds a second piece of Microsoft open technology running in production that the partnership page can point to.

## Step 0: re-derive the current state

    sed -n 1,120p api/_lib/llm.js; sed -n 1,80p api/_lib/agent-model.js
    grep -rn -i "provider\|model:" api/_lib/llm.js | head -40
    sed -n 1,120p docs/ops/gcp-model-workers.md
    ls workers | grep model- ; sed -n 1,60p workers/model-trellis2/Dockerfile
    ls packages | grep -i eval; grep -n -i "eval" package.json | head

Pick the Phi model from Hugging Face by reading the current model cards (license must be MIT; check context length, tool-calling support and the recommended serving setup). Pick the server (vLLM is the default choice for an OpenAI-compatible endpoint with tool calling; verify its license and that it supports the chosen Phi).

## Tasks

1. **Worker.** `workers/model-phi/` following the existing GPU worker conventions (Dockerfile, health route, auth between the API and the worker exactly as other workers do it, weights baked or pulled from our bucket with a checksum), serving an OpenAI-compatible `/v1/chat/completions` with tool calling and streaming, scale-to-zero settings appropriate for an L4 on Cloud Run GPU.
2. **Verify on GCP.** Build and run it through Cloud Build or a Cloud Run job (memory: local long model runs die at session teardown; verify-only Cloud Build survives) and record throughput, time to first token, cold start and cost per 1,000 requests.
3. **Brain lane.** Add `phi` as a provider in `api/_lib/llm.js` behind `PHI_WORKER_URL`, usable by name in agent settings and by internal callers. Route the cheap internal tasks you find in step 0 (memory summarization, classification, emote tags) to it when configured, with automatic fallback to the current provider on error or timeout, logged.
4. **Evaluation.** A real comparison on 50 to 100 tasks sampled from the repo's existing eval sets or anonymized real agent tasks (summaries, intent labels, tool calls): Phi versus the current default, scored by the existing evaluator or an LLM judge with a rubric. Write results to `docs/phi-brain-lane.md` and route only the task types where Phi meets the bar.
5. **Docs.** Worker README, `docs/phi-brain-lane.md` (model, license, numbers, routing table), link from docs/microsoft.md as Microsoft open source in the stack, STRUCTURE.md row, changelog entry.

## Definition of done

- [ ] Test-first tests for the provider adapter (request mapping, tool-call parsing, streaming, fallback on timeout).
- [ ] A real GCP run of the worker answers chat, streaming and tool-call requests; latency and cost numbers in the report.
- [ ] The evaluation table exists with real numbers and the routing matches it.
- [ ] Docs, STRUCTURE.md, changelog landed; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Deploying a new long-lived Cloud Run service | Verify with Cloud Build or a Cloud Run job; put the exact `gcloud run deploy` command in the owner message. The adapter ships dormant until `PHI_WORKER_URL` is set. |
| GPU quota in the region | Try the regions the other GPU workers use (see docs/ops/gcp-model-workers.md); record the result. |
| Vertex or GCP 403 | Check memory `gcp-vertex-billing-403` first; billing can look like auth. |
| Phi fails the bar on a task type | Do not route it; record why. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
