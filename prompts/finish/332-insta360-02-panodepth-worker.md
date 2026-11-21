# insta360 02: the `model-panodepth` worker turns one 360 photo into a metric depth shell (GLB plus PLY)

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `insta360-` order, so it can run in parallel with all of them. Dev port: 3332 (only if you open a page).

## Operating clause (binding)

- Read CLAUDE.md, then [_context/insta360-00-CONTEXT.md](_context/insta360-00-CONTEXT.md) (contract C2 is yours, independence rules, GPU and fixture rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Creating the Cloud Run service and pointing `three-ws-api` at it are owner steps owned by order 347: you prove the image live as a Cloud Run Job instead. Never contact a third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

"Step inside your 360 photo" is the feature an Insta360 owner can try in 30 seconds with a photo already on their phone. A monocular panorama depth model gives metric depth per pixel; lifted to a mesh shell it is a walkable room you own as a GLB. The research doc (section 4b) picked MoGe-2 `infer_panorama` (code MIT) and flagged that its weight license must be confirmed on adoption day.

## Step 0: re-derive the current state

    ls workers/ | grep -iE "depth|pano"
    sed -n 1,80p workers/model-video2scene/README.md
    ls workers/model-video2scene workers/model-video2motion
    npm run check:vendored 2>&1 | tail -5
    gcloud storage ls gs://three-ws-model-weights/ | head -40
    gcloud compute regions list --project aerial-vehicle-466722-p5 --format="value(name)" | head -40

Then read the MoGe repository's README, LICENSE and the Hugging Face model cards of every MoGe-2 checkpoint today, and record the exact license text for code and for weights.

## Tasks

1. **Pick the model with evidence, not memory.** Adopt MoGe-2 if its weights are under a license that permits commercial hosted inference (MIT, Apache-2.0, BSD, or similar). If they are not, evaluate in order: Depth Anything V2 Small (Apache-2.0; the larger checkpoints are non-commercial, do not use them) through MoGe's perspective-split-and-merge panorama method reimplemented in your worker, then any other commercially licensed metric depth model you find on the day. Never adopt anything in the context file's out-of-scope list. Record the decision, license URLs and the date in `workers/model-panodepth/README.md` and in the `stats.license` field the worker returns.
2. **Worker** `workers/model-panodepth/`, structured like [workers/model-video2scene](../../workers/model-video2scene): FastAPI `main.py` implementing contract C2 exactly (`POST /infer`, `GET /tasks/{id}`, `GET /health`), bearer auth via the vendored `worker_security.py` (copy byte-identical from a sibling worker, then `npm run check:vendored`), SSRF-safe download of `image_url` with a size cap (200 MB) and image-type sniffing, task state in memory plus a GCS result manifest so a restarted instance can answer `GET /tasks` for finished jobs.
3. **Inference**: equirect in (JPEG, PNG, EXR; resize to the model's best working resolution, record it), metric depth and validity mask out. Save `depth.exr` (float32, metres) or a 16-bit PNG plus scale in the stats.
4. **Mesh shell**: lift the equirect depth to a sphere-parameterized grid mesh (vertices along each pixel ray at its depth), close the seam at longitude 180 degrees and the poles, drop triangles across depth discontinuities (edge-length ratio test, threshold tuned on real photos and recorded), decimate to a sensible face budget (default 1.5M faces, `max_points` caps the PLY), UV-map the original photo as the texture (JPEG, up to 8192x4096), write glTF with +Y up and -Z forward, camera at the origin, units metres. Validate with `gltf-validator` (npx) at zero errors.
5. **Point cloud**: `scene.ply` with colours, at most `max_points`, for viewers that prefer points.
6. **Image**: Dockerfile on a CUDA runtime base matching the chosen model, weights baked from `gs://three-ws-model-weights/panodepth/` (upload them there from the official release, record SHA-256), non-root user, `$PORT`. `cloudbuild.yaml` (build and push, pinning the `three-ws-build@` service account) and `cloudbuild.verify.yaml` modelled on video2scene's verify config. `requirements.txt` with pinned versions.
7. **GPU proof as a Cloud Run Job** (context file "GPU proof without a production deploy"): pick a region with free L4 quota, run the image as a job that executes a `verify` entrypoint over at least 5 real 360 photos (indoor small room, indoor large hall, outdoor street, outdoor open landscape, and one Insta360 sample with its EXIF camera model recorded), writes results to `gs://three-ws-pano-captures/depth/verify-<date>/`, and prints per-photo timing. Then open each GLB in the three.ws viewer locally and check it visually from the origin and from 1 m off-centre.
8. **Tests** (`pytest` in the worker): auth, SSRF rejection, aspect validation, seam closure (no gap vertex pairs across the wrap), discontinuity culling on a real depth map from your verify run (commit only the small `.npz` if under 1 MB), glTF validator pass. README: API, env (`API_KEY`, `RESULT_BUCKET`), build and verify commands, measured latency and cost per photo, license section.

## Definition of done

- [ ] `workers/model-panodepth/` exists with code, Dockerfile, both cloudbuild files, pinned requirements, tests and README; `npm run check:vendored` passes.
- [ ] Weight license verified from primary sources on the day and recorded with URLs.
- [ ] A Cloud Run Job execution with a GPU processed 5 or more real 360 photos; GLB validator errors are 0 for every output; median seconds per photo recorded.
- [ ] Each GLB looks right in the three.ws viewer (no seam crack, no stretched curtains across depth edges) and the report says what you inspected.
- [ ] Worker tests pass; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| L4 quota full everywhere you try | Try A100 or H100 regions, then `nvidia-l4` in europe-west4, asia-southeast1, us-east4. Record what you tried. A job, not a service, so no lingering cost. |
| MoGe-2 weights turn out non-commercial | Task 1's fallback order. The contract does not change. |
| Docker image build exceeds the local disk | Build only through Cloud Build with `TMPDIR=/home/user/.cache/gcloud-tmp`. |
| No Insta360 photo found | Wikimedia Commons equirect photos with Insta360 in EXIF; any 360 camera works for the other four. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass except the owner's service creation: leave this file in `finish/`, put a dated status line under the title ("image proven by job <execution id>; service creation waits on order 347"), and append to [_context/insta360-PROGRESS.md](_context/insta360-PROGRESS.md) with the image digest, region and median seconds per photo.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured numbers; the one batched owner message (the exact `gcloud run deploy` command for the service, ready to paste); one-line judgment calls. No trailing questions.
