# insta360 07: the `model-pano2splat` service: HTTP API, GPU image, Cloud Build and a GPU job harness

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `insta360-` order, so it can run in parallel with all of them. No dev server.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/insta360-00-CONTEXT.md](_context/insta360-00-CONTEXT.md) (contract C1 service API is yours; you own `main.py`, `Dockerfile`, `requirements.txt`, `cloudbuild*.yaml`, `README.md` and the vendored modules in `workers/model-pano2splat/`; the stage packages belong to 334, 335 and 336). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Creating the Cloud Run service is an owner step owned by order 347; you prove the image with a Cloud Run Job. Never contact a third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The three stages are CLIs; this order makes them a service the API can call, with one image that carries CUDA, COLMAP 4.2, gsplat, ffmpeg and the stitcher. You call the stages only as subprocesses with the contract flags, so you can build and test the whole service before they exist: if a stage package is missing on disk when you run, the service reports it in `/health` and fails that task with a clear error, and your tests use small contract-speaking executables.

## Step 0: re-derive the current state

    find workers/model-pano2splat -maxdepth 2 2>&1 | head -60
    sed -n 1,200p workers/model-video2scene/main.py
    cat workers/model-video2scene/Dockerfile workers/model-video2scene/cloudbuild.yaml workers/model-video2scene/cloudbuild.verify.yaml
    npm run check:vendored 2>&1 | tail -5
    grep -rn "model-video2scene" scripts/*.mjs package.json | head
    gcloud artifacts repositories list --project aerial-vehicle-466722-p5 --format="value(name)"

Record how video2scene structures tasks, auth, GCS upload, signed URLs, the verify config and where its image is pushed. Note which stage packages exist on disk today.

## Tasks

1. **Service** `workers/model-pano2splat/main.py`, FastAPI, implementing contract C1's HTTP API exactly. Bearer auth with the vendored `worker_security.py` (byte-identical copy; `npm run check:vendored`). SSRF-safe streaming download of `source_url`/`source_urls` to local disk with a running byte cap (`max_source_bytes`, 8 GiB) and content sniffing per `source_kind`. One task runs at a time per instance (GPU is the bottleneck); others queue with honest `queued` status and position.
2. **Orchestration**: per `source_kind`, run `python -m pano_stitch` (for `insv`/`insp`), then `python -m pano_sfm`, then `python -m splat_train --preview-video`, each as a subprocess with the quality preset flags from contract C1. Parse JSON-lines progress into one task `stage` and `progress` (weights: download 5, stitch 15, frames plus sfm 35, train 40, export plus upload 5; tune after measuring). On non-zero exit, read the stderr JSON line and surface its `code` and `message` unchanged. `DELETE /tasks/{id}` terminates the subprocess group cleanly. A per-stage wall-clock timeout (generous, measured) prevents a hung task from holding the GPU.
3. **Results**: upload outputs to `gs://three-ws-pano-captures/<task_id>/` (create the bucket per the context file if absent, with the 30-day lifecycle), return V4 signed URLs valid 7 days (signing through the runtime service account's IAM `signBlob`, the way sibling workers sign; find it in step 0). Persist a task manifest JSON beside the outputs so any instance can answer `GET /tasks/{id}` for finished tasks after a restart.
4. **`/health`** per contract: GPU present (`torch.cuda.is_available()` or `nvidia-smi`), COLMAP and gsplat versions, and which stage packages import cleanly.
5. **Image**: `Dockerfile` on an NVIDIA CUDA 12.x runtime base, COLMAP 4.2 built with CUDA (multi-stage: build stage compiles, runtime stage copies binaries), ffmpeg with NVENC and NVDEC, Python deps from `requirements.txt` plus every file in `requirements.d/` (the stage orders own those files), non-root user, `$PORT`. Keep the image lean and record its size. `cloudbuild.yaml` builds and pushes to Artifact Registry with the `three-ws-build@` service account and a machine type big enough to compile COLMAP; `cloudbuild.verify.yaml` builds and then runs the job harness (task 6). Wire `package.json` scripts only if sibling workers have them (hot file, anchored edit, last).
6. **GPU job harness** `workers/model-pano2splat/verify.py`: an entrypoint that runs the whole pipeline in-process (same orchestration code as the service, no HTTP) over every entry in `gs://three-ws-capture-fixtures/insta360/MANIFEST.json` with a `verify: true` flag, writes outputs and a `verify-report.json` (per fixture: stages, timings, stats, errors) to `gs://three-ws-pano-captures/verify-<date>/`. Run it as a Cloud Run Job with an L4 GPU in a region with quota (context file). Stages that do not exist yet are reported as missing; whatever exists runs for real.
7. **Tests** (`pytest`, `tests/test_service.py`): auth, SSRF and size cap, queueing, orchestration with tiny executables that honour the C1 CLI contract (progress lines, exit codes, stderr JSON), cancellation kills the process group, manifest persistence across a simulated restart, signed URL shape. README: API, env (`API_KEY`, `RESULT_BUCKET`, `FIXTURE_BUCKET`), build, verify, the job command, measured image size, cold start and per-minute-of-footage cost, and the exact `gcloud run deploy` command for 347 (GPU, concurrency 1, min instances 0, max instances sized to quota, timeout 3600, CPU and memory measured).

## Definition of done

- [ ] Service implements contract C1 field for field; tests pass; `npm run check:vendored` passes.
- [ ] Image builds in Cloud Build and is pushed; size recorded.
- [ ] A Cloud Run Job execution with a GPU ran `verify.py` against the real fixture manifest; the report lists, honestly, which stages ran and their real outputs and timings.
- [ ] README complete including the ready-to-paste service deploy command; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Stage packages not on disk yet | Expected. Build, test with contract executables, run the harness; it records missing stages. 347 reruns it when all exist. |
| COLMAP CUDA build fails or takes too long | Use the official `colmap/colmap` CUDA image as the build stage and copy binaries; pin its tag; record the choice. |
| Fixture manifest empty | Add real redistributable 360 videos yourself per the context file rules (Wikimedia Commons CC equirect videos qualify) and merge them into the manifest. |
| L4 quota | Context file region list; A100 fallback. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. Service creation is the owner's: leave this file in `finish/` with a dated status line ("image <digest> proven by job <execution>; service deploy waits on 347"). Append to [_context/insta360-PROGRESS.md](_context/insta360-PROGRESS.md) with the digest, region, image size and verify results.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured numbers; the one batched owner message (the deploy command); one-line judgment calls. No trailing questions.
