# nvidia 12: NVIDIA Triton Inference Server serves the high-volume small-model workers with dynamic batching

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3262.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Small per-request models (background removal, segmentation, captioning) run one request at a time in their own Python servers, which wastes the GPU under bursty load. NVIDIA Triton Inference Server batches concurrent requests dynamically and exposes standard metrics. Moving the busiest small models onto Triton raises throughput per GPU, and moves Triton from "under evaluation" to production in the Inception record.

## Step 0: re-derive the current state

    ls workers/rembg workers/segment workers/model-florence2 2>/dev/null
    gcloud run services list --project aerial-vehicle-466722-p5 --format="table(metadata.name,region,spec.template.spec.nodeSelector)"

Measure request volume and p95 per small-model service from Cloud Logging or Cloud Monitoring for 30 days. Pick the one to three services with the most GPU time. Record whether each runs on GPU today.

## Tasks

1. **Model repository**: export the chosen models to ONNX or TensorRT (or Triton's Python backend where export is not faithful), with `config.pbtxt` using dynamic batching and tuned instance groups.
2. **Compatibility adapter**: keep each service's existing HTTP contract so no caller changes, translating to Triton's API inside the container.
3. **Load test** with real images (a k6 or Locust script in `scripts/` run from a VM in the same region): throughput, p50, p95 and GPU utilization old versus new at several concurrency levels.
4. **Deploy** as a new Cloud Run GPU revision behind a traffic split, promote where it wins. Export Triton metrics to Cloud Monitoring.
5. **Parity** tests on output masks or captions versus the current service.
6. **Claim rule** updates once serving traffic (anchored edits, last); write-up `docs/nvidia-triton-serving.md`; changelog entry.

## Definition of done

- [ ] Load-test table committed for old versus new.
- [ ] Callers unchanged; parity tests pass; the promoted revision served real traffic (revision name).
- [ ] `npm test` passes; docs landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A model's outputs drift after export | Use Triton's Python backend for that model; batching still applies. |
| A chosen service is CPU-only and cheap | Drop it from scope and pick the next by GPU time. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
