# nvidia 11: NVIDIA TensorRT accelerates the busiest self-hosted 3D generation worker, with measured speedup and output parity

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `nvidia-` order, so it can run in parallel with all of them. Dev port: 3261.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/nvidia-00-CONTEXT.md](_context/nvidia-00-CONTEXT.md) (facts, the technology-claim rule, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (push, `three-ws-api` deploy, Inception portal edits, NVIDIA submissions, forum or social posts) into ONE message at the end. Never contact NVIDIA or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The GPU workers are PyTorch plus CUDA. TensorRT is listed as "under evaluation" in the Inception product record, and NVIDIA's guidance to members points straight at it. Making the busiest worker measurably faster with TensorRT cuts user wait time, raises throughput on scarce L4 quota, and moves TensorRT from evaluation to production in the record: a real technical milestone with a number NVIDIA can share.

## Step 0: re-derive the current state

    gcloud run services list --project aerial-vehicle-466722-p5 --format="csv[no-heading](metadata.name,region,spec.template.spec.nodeSelector)" | grep -i accelerator

Query `forge_worker_stats` (read-only) for job count and p50 and p95 per worker over 30 days. Pick the worker with the largest jobs times p50 product, excluding `workers/model-trellis` (owned by order 981). Read its Dockerfile, model code and deploy runbook.

## Tasks

1. **Baseline on the real GPU**: run the worker image on an L4 (a GCE L4 VM or a Cloud Run GPU job in a region with quota) and profile with Nsight Systems or the PyTorch profiler over a fixed set of at least 20 inputs with fixed seeds. Record per-stage time, VRAM and cold start.
2. **Convert the hot modules** with Torch-TensorRT or ONNX to TensorRT, FP16 (FP8 only where the GPU supports it and parity holds). Engines cached per GPU architecture and TensorRT version in GCS, built ahead on the matching GPU, never on the request path.
3. **Parity**: compare outputs to the baseline on the same inputs (mesh chamfer distance, render PSNR and SSIM from fixed views); thresholds stated up front; fail the build if exceeded.
4. **Canary**: deploy a new revision with a traffic split or flag, measure p50, p95, cold start and VRAM on real requests, then promote if it wins and parity holds. Keep the PyTorch path as fallback for unsupported inputs.
5. **Claim rule**: once promoted and serving traffic, update the technology lists in [docs/nvidia-apps-catalog-listing.md](../../docs/nvidia-apps-catalog-listing.md) and [docs/nvidia-models.md](../../docs/nvidia-models.md) with service, revision and number (anchored edits, last), and put the portal update in the owner message.
6. **Write-up** `docs/nvidia-tensorrt-<worker>.md`: method, numbers, what did not convert and why; forum-post-ready. Changelog entry.

## Definition of done

- [ ] Baseline and TensorRT numbers on the same GPU and inputs, with parity metrics (report table).
- [ ] The canary revision served real requests; promoted or not, with the reason.
- [ ] Worker tests and `npm test` pass; docs landed; claim lists changed only if promoted.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| An op does not convert | Convert the submodules that do and keep PyTorch for the rest; record which. |
| us-central1 L4 quota is full | Canary in another region with L4 quota. |
| Local docker dies at session end | Run long builds and benchmarks through Cloud Build or on the GCE VM, not locally. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/nvidia-PROGRESS.md](_context/nvidia-PROGRESS.md), including the measured number this order produced.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured number; the one batched owner message; one-line judgment calls. No trailing questions.
