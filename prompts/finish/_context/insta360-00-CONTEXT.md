# insta360 campaign: shared context and interface contract

Not a work order. Never run this file. Every `prompts/finish/3NN-insta360-*.md` order (331 to 347) names it in its first lines; read it before step 0. CLAUDE.md overrides everything here.

## What the campaign builds

People who shoot on Insta360 cameras (and any other 360 camera) bring their footage to three.ws and get 3D they own:

1. **360 photo as the avatar's world**: a user's equirectangular photo becomes the environment lighting and backdrop in the viewer and in `/splat`.
2. **Step inside a 360 photo**: one equirect photo (or raw `.insp`) becomes a metric depth shell (GLB plus PLY) you can stand inside.
3. **360 walkaround video to Gaussian splat**: a stitched equirect video, a set of equirect photos, or a raw `.insv` becomes a downloadable splat scene (PLY plus SPZ) with a flythrough preview video, opened in `/splat`.
4. **360 video to motion capture**: a 360 clip of a person becomes an animation through the existing video2motion worker.
5. **Plugins and agent access**: the Blender extension, a Premiere Pro UXP panel, the MCP server, the CLI and the OpenAPI schema all reach the same lanes.

The research behind every choice (licenses, rankings, rejected options, sources) is [docs/research/insta360-360-capture-2026-11.md](../../../docs/research/insta360-360-capture-2026-11.md). Read its sections 3 to 6 before building. Do not re-litigate its verdicts; re-check a license only on the day you adopt the dependency.

## How independence works (read this twice)

Every order 331 to 346 can run in a fresh chat, in parallel with every other, in any order. That works because:

- **Cross-order boundaries are only HTTP endpoints, CLI process calls and file formats, all fixed in the contract below.** No order imports another order's JS or Python module. If you need something another order owns, call it over its contract boundary, exactly as specified, even if it does not exist yet.
- **Unit tests may stand in for another order's side of a boundary** (a local HTTP server or a tiny executable that speaks the contract), because the live counterpart may not exist yet. That is the only place a stand-in is allowed. Production code never contains a fake, sample or fallback result.
- **Every order also proves its own side live** against real data: real footage, real images, real model weights, the real database (isolated PGlite per the memory note `isolated-db-live-checks`), the real R2 bucket. Where the counterpart already exists on disk when you run (check in step 0), prove against it live too.
- **Order 347 runs last.** It wires the pieces together end to end on real Insta360 footage, fixes every seam, and batches the owner steps into one message. It is the only order that depends on the others.
- If you find the contract is wrong or incomplete for your piece, extend it compatibly (add optional fields, never rename or remove), update this file with a small anchored edit, and note it in the progress log so siblings and 347 see it.

## The contract

### C1. Worker `model-pano2splat` (`workers/model-pano2splat/`)

One Cloud Run GPU worker image with three stage packages, each a standalone CLI, plus a service shell that runs them as subprocesses.

| Package | Owner order | CLI |
|---|---|---|
| `pano_stitch/` | 336 | `python -m pano_stitch --input <file.insv[,file2.insv] or file.insp> --out <dir> [--level-horizon] [--max-width 7680] [--trim-start S] [--trim-end S]` |
| `pano_sfm/` | 334 | `python -m pano_sfm --input <equirect.mp4 or dir of equirect .jpg/.png> --out <dir> [--fps 2] [--max-frames 300] [--views 8\|12\|14] [--mask-operator] [--mask-sky] [--trim-start S] [--trim-end S]` |
| `splat_train/` | 335 | `python -m splat_train --colmap <dir> --out <dir> [--iterations 30000] [--max-gaussians 3000000] [--preview-video] [--holdout-every 8]` |
| `main.py` service, Dockerfile, cloudbuild files, README | 337 | FastAPI on `$PORT` |

**Stage outputs (file format boundary):**

- `pano_stitch` writes `<out>/equirect.mp4` (video input, H.264 or H.265, 2:1) or `<out>/equirect.jpg` (photo input), plus `<out>/stitch.json`: `{ "camera_model": "X5", "lens_layout": "two_track|side_by_side|split_pair", "calibration_model": "equidistant|mei|mei_r5", "width": 7680, "height": 3840, "fps": 29.97, "duration_s": 41.2, "frames": 1235, "horizon_leveled": true, "imu_samples": 41230, "warnings": [] }`.
- `pano_sfm` writes a standard COLMAP dataset: `<out>/images/` (perspective views, named `<frame:05d>_<view:02d>.jpg`), `<out>/masks/` (same names plus `.png`, white = keep, optional), `<out>/sparse/0/{cameras,images,points3D}.bin`, plus `<out>/sfm.json`: `{ "frames_used": 240, "views_per_frame": 8, "registered_images": 1830, "total_images": 1920, "registration_ratio": 0.953, "mean_reproj_error_px": 0.71, "points3d": 412000, "duration_s": 512.4, "warnings": [] }`.
- `splat_train` reads any standard COLMAP dataset (images, optional masks, `sparse/0`) and writes `<out>/scene.ply` (standard 3DGS PLY readable by the Inria viewer layout, by `/splat`, and by the KIRI Blender add-on), `<out>/scene.spz`, `<out>/preview.mp4` (flythrough along the smoothed capture path, 1920x1080, 30 fps, at most 20 s) when `--preview-video`, `<out>/poster.jpg`, and `<out>/train.json`: `{ "iterations": 30000, "gaussians": 2410000, "psnr_holdout": 27.4, "ssim_holdout": 0.86, "duration_s": 1310.0, "bytes_ply": 0, "bytes_spz": 0 }`.

**Exit codes (all three CLIs):** `0` success; `1` internal error; `2` unsupported input (for example an unsupported camera model); `3` corrupt or unreadable input; `4` reconstruction quality failure (`pano_sfm`: registration ratio below 0.6; `splat_train`: holdout PSNR below 18). On any non-zero exit the last line of stderr is one JSON object `{ "error": "<snake_case_code>", "message": "<sentence a visitor can read>" }`. Progress goes to stdout as JSON lines `{ "stage": "<name>", "progress": 0.0..1.0 }`.

**Service HTTP API (owner 337):**

    POST /infer        Authorization: Bearer $API_KEY
      { "task": "splat" | "stitch",
        "source_url": "https://...",                  // one file
        "source_urls": ["https://..."],               // optional: split-pair .insv or a set of equirect photos
        "source_kind": "equirect_video" | "equirect_images" | "insv" | "insp",
        "trim": { "start_s": 0, "end_s": 60 },        // optional
        "quality": "preview" | "standard" | "high",   // default standard
        "job_id": "caller correlation id" }
      -> 202 { "task_id": "..." }
    GET  /tasks/{task_id}   Authorization: Bearer $API_KEY
      -> { "status": "queued|running|succeeded|failed|cancelled",
           "stage": "download|stitch|frames|sfm|train|export|upload",
           "progress": 0.0..1.0,
           "result": { "ply_url", "spz_url", "preview_url", "poster_url", "equirect_url", "stats": { "stitch": {...}, "sfm": {...}, "train": {...} } },
           "error": { "code": "...", "message": "..." } }
    DELETE /tasks/{task_id} -> 200 { "status": "cancelled" }
    GET  /health -> { "ok": true, "gpu_available": bool, "colmap_version": "4.2.x", "gsplat_version": "...", "max_source_bytes": 8589934592 }

`task: "stitch"` runs only `pano_stitch` and returns `equirect_url`. Quality presets: `preview` = 1 fps, at most 120 frames, 7000 iterations; `standard` = 2 fps, 300 frames, 30000 iterations; `high` = 3 fps, 600 frames, 30000 iterations, 6M Gaussian cap. Results go to `gs://three-ws-pano-captures/<task_id>/` and are returned as V4 signed https URLs valid 7 days.

### C2. Worker `model-panodepth` (`workers/model-panodepth/`, owner 332)

    POST /infer   Bearer
      { "image_url": "https://... equirect jpg/png/exr", "job_id": "...", "max_points": 2000000, "mesh": true }
      -> 202 { "task_id": "..." }
    GET /tasks/{task_id}
      -> { "status", "progress", "result": { "glb_url", "ply_url", "depth_url", "stats": { "width", "height", "median_depth_m", "points", "faces", "model": "<model id>", "license": "<spdx>" } }, "error": { "code", "message" } }
    GET /health -> { "ok", "gpu_available", "model", "weights_present" }

The GLB is a single textured mesh shell in metres, camera at the origin, +Y up, -Z forward (glTF convention), seams closed at the equirect wrap, faces on depth discontinuities removed. Results in `gs://three-ws-pano-captures/depth/<task_id>/`, signed URLs valid 7 days.

### C3. Worker `model-video2motion` 360 extension (owner 341)

`POST /infer` on the existing worker gains two optional fields: `"projection": "perspective" | "equirect"` (default `perspective`, today's behaviour unchanged) and `"subject": { "yaw_deg": -180..180, "pitch_deg": -90..90 }` (initial look direction toward the person; omitted means auto-detect the most prominent person). Convention: yaw 0 and pitch 0 are the centre pixel of the equirect frame; yaw grows to the right (image x increases), pitch grows upward (image y decreases); so pixel (x, y) in a W by H frame is `yaw = (x / W - 0.5) * 360`, `pitch = (0.5 - y / H) * 180`. With `equirect`, the worker tracks the subject across the sphere, renders a perspective reframe that follows them, runs the existing pose pipeline on it, and returns the existing result shape plus `"reframe_url"` (the perspective video it tracked) and `"subject_track"` (per-frame yaw/pitch). `api/motion-swap.js` passes both fields through.

### C4. Node API endpoints

| Endpoint | Owner | Contract |
|---|---|---|
| `POST /api/capture-upload/create` | 338 | `{ filename, content_type, size_bytes, kind: "pano" }` -> `{ upload_id, key, part_size, part_count }`. Account required (`requireCreator`). Max 8 GiB. Accepts `video/mp4`, `video/quicktime`, `image/jpeg`, `image/png`, `image/x-exr`, and `application/octet-stream` only when the filename ends in `.insv`, `.insp` or `.lrv`. |
| `POST /api/capture-upload/sign` | 338 | `{ upload_id, key, part_numbers: [1,2,...] }` (at most 100 per call) -> `{ urls: { "1": "https://..." } }` presigned R2 `UploadPart` URLs, 1 hour. |
| `POST /api/capture-upload/complete` | 338 | `{ upload_id, key, parts: [{ part_number, etag }] }` -> `{ source_url, size_bytes }` (a public or signed https URL the workers can fetch). |
| `POST /api/capture-upload/abort` | 338 | `{ upload_id, key }` -> `{ ok: true }`. |
| `POST /api/capture-upload/parts` | 338 (extension, recorded by 347) | `{ upload_id, key }` -> `{ parts: [{ part_number, etag, size }] }`, the parts R2 already holds, so a resumed upload re-signs and re-sends only the missing ones. 404 `upload_not_found` when the upload expired or completed. Used by `src/multipart-upload.js` (the browser upload), the CLI capture command and the Premiere panel client. |
| `POST /api/pano-capture` | 339 | `{ source_url, source_urls?, source_kind, trim?, quality? }` -> 202 `{ job_id, status, eta_seconds }`. Account required, rate-limited on the `mcp3dGenerate` bucket. |
| `GET /api/pano-capture?job=<id>` | 339 | `{ job_id, status, stage, progress, result?: { ply_url, spz_url, preview_url, poster_url, viewer_url }, error?: { code, message } }`. `viewer_url` is `/splat?src=<encoded spz_url>`. Result files are copied from the worker bucket to R2 under `captures/pano/<user_id>/<job_id>/` so they outlive the 7-day signed URLs. |
| `GET /api/pano-capture?mine=1` | 339 | `{ captures: [{ job_id, status, created_at, poster_url, viewer_url, source_kind }] }`, newest first, the caller's own only. |
| `DELETE /api/pano-capture?job=<id>` | 339 | Cancels a running job (worker `DELETE /tasks`) or deletes a finished one and its R2 files. Owner only. |
| `POST /api/pano-scene`, `GET /api/pano-scene?job=<id>` | 333 | `{ image_url, source_kind: "equirect_image" \| "insp" }` -> 202 `{ job_id }`; poll -> `{ status, progress, result?: { glb_url, ply_url, viewer_url }, error? }`. For `insp` the API first calls `model-pano2splat` with `task: "stitch"` (C1) and then `model-panodepth` (C2) with the returned `equirect_url`. |

Every endpoint above: CORS via `api/_lib/http.js`, SSRF-checked URLs (`assertPublicHttpsUrl`), errors as `{ error, message }` with a visitor-readable `message`, a clean 503 `unconfigured` (operator hint in `hint`, never rendered) when its worker env var is unset, exactly like [api/scene-capture.js](../../../api/scene-capture.js).

### C5. Environment variables

| Var | Meaning | Used by |
|---|---|---|
| `GCP_PANO2SPLAT_URL` | Base URL of the `model-pano2splat` service | 333, 339 |
| `GCP_PANODEPTH_URL` | Base URL of the `model-panodepth` service | 333 |
| `GCP_RECONSTRUCTION_KEY` | Existing bearer secret (Secret Manager `avatar-reconstruction-key`), shared by every reconstruction worker | all API orders; workers read it as `API_KEY` |

Never invent another secret. Add new vars to `api/_lib/env.js` (hot file, edit last) and to [.env.example](../../../.env.example) if it lists its siblings.

### C6. Pages and file ownership

| Surface | Owner | Notes |
|---|---|---|
| Viewer environment pipeline ([src/viewer/environment.js](../../../src/viewer/environment.js)) and its UI, `/splat` backdrop control | 331 | |
| `/pano-scene` page (new: `pages/pano-scene.html`, `src/pano-scene.js`) | 333 | |
| `/capture` 360 mode ([pages/capture.html](../../../pages/capture.html), [src/scene-capture.js](../../../src/scene-capture.js), new `src/capture-360.js`, new `src/multipart-upload.js`) | 340 | The browser multipart uploader lives here, not in 338. |
| `/video-to-motion` and `/motion-swap` 360 input | 342 | |
| [integrations/blender/](../../../integrations/blender) | 343 | |
| `integrations/premiere-uxp/` (new) | 344 | |
| MCP tools, OpenAPI, `three-ws-cli` | 345 | |
| `/insta360` landing page and `docs/tutorials/insta360-to-3d.md` | 346 | |

## Rules for running every order at once in one worktree

1. **Dev port**: `npm run dev -- --port 3<NNN> --strictPort` where NNN is your order number (order 340 uses 3340). Never port 3000.
2. **Shared hot files** (`data/changelog.json`, `data/pages.json`, `STRUCTURE.md`, `vercel.json`, `vite.config.js`, `api/_lib/env.js`, `package.json`, `docs/research/insta360-360-capture-2026-11.md`, this file): edit them LAST, re-read immediately before each edit, use small anchored `Edit` calls, never rewrite the file, commit right after.
3. **Commit via a private index** (memory `commit-via-private-index`) or `git commit --only <paths>`; never `git add -A`. Run `npm run check:rules -- --paths <files>` (exit 0) before every commit.
4. **Workers**: edit only the worker your order names. `model-pano2splat` is shared by 334, 335, 336 and 337; each touches only its own package directory (C1 table) plus its own tests. 337 owns `Dockerfile`, `requirements.txt`, `cloudbuild*.yaml`, `main.py` and `README.md`; stage orders append their dependencies to `workers/model-pano2splat/requirements.d/<package>.txt` (one file per stage) and 337's Dockerfile installs every file in that directory. Vendored shared modules (`worker_security.py` and friends) stay byte-identical: `npm run check:vendored`.
5. **Migrations**: only 339 writes one. Fresh UTC timestamp name under `api/_lib/migrations/`. Read the `self-unblock-playbook` skill's database row and run `npm run db:status` before `npm run db:migrate` (it applies immediately).
6. **Tests**: your own suite on every change (`npx vitest run tests/<yours>.test.js`, or the worker's `pytest`/`unittest`), and `npm test` once before close-out. A failure you did not cause gets one line in the report, not a detour.
7. **Generated files**: after appending to `data/changelog.json`, run `npm run build:pages` and commit what it regenerates. Every user-visible order appends its own changelog entry and docs (CLAUDE.md "Changelog and documentation").

## GPU, storage and fixtures

- Project `aerial-vehicle-466722-p5`. GCP spend is pre-approved; never downgrade quality to save credits.
- **us-central1 L4 quota is fully held** (memory `l4-quota-us-central1-starved`). GPU proofs run in another region with free L4 (or A100/H100) quota: check with `gcloud compute regions describe <region> --project aerial-vehicle-466722-p5 --format=json | jq '.quotas[] | select(.metric|test("L4|A100|H100"))'` and pick one. Weights for a non-us-central1 region go in the matching regional bucket (for example `gs://three-ws-model-weights-euw4`) or are read cross-region.
- **GPU proof without a production deploy**: build the image with Cloud Build (`TMPDIR=/home/user/.cache/gcloud-tmp`, memory `gcloud-submit-root-disk-full`; long runs go through Cloud Build, memory `long-gpu-model-runs-use-cloud-build`), push it to Artifact Registry, and run it as a **Cloud Run Job with a GPU** (`gcloud run jobs create/execute ... --gpu 1 --gpu-type nvidia-l4`) against real fixtures. A job execution is a verification run, not a deploy. Creating or updating a Cloud Run **service**, setting env vars on `three-ws-api`, and `npm run deploy:gcp:full` are batched owner steps owned by order 347.
- Buckets: create `gs://three-ws-pano-captures` (results, 30-day lifecycle) and `gs://three-ws-capture-fixtures` (test footage, no lifecycle) if absent, with `gcloud storage buckets create gs://<name> --project aerial-vehicle-466722-p5 --location us-central1 --uniform-bucket-level-access` (ignore "already exists"; a sibling may have made it first). Grant the runtime SA `three-ws@` object admin on both.
- **Fixtures are real footage, never synthetic.** Find publicly downloadable, redistributable Insta360 samples (raw `.insv`/`.insp` from public sample-footage pages, issue trackers that attach samples such as GyroView's and telemetry-parser's, and CC-licensed equirect videos and photos on Wikimedia Commons). Record source URL, license, camera model and SHA-256 for each in `gs://three-ws-capture-fixtures/insta360/MANIFEST.json` (re-read and merge, siblings append too) and mirror the manifest in `workers/model-pano2splat/fixtures/MANIFEST.md`. Never commit footage to git. Small trailer-only fixtures under 1 MB with a compatible license may be committed under the worker's `tests/fixtures/` with their license file.

## Saying it correctly (every UI string, doc and post)

- Insta360 is a third-party trademark used nominatively: "works with Insta360 cameras", "for footage from Insta360 X3, X4, X5 and X6". Never imply a partnership, endorsement or official integration, never use the Insta360 logo, and never put "Insta360" inside a three.ws product name.
- Say "any 360 camera" wherever the feature is camera-agnostic (stitched equirect input is).
- Insta360's own app feature is Spatial Capture. Our positioning is factual: you get the file (PLY, SPZ, GLB), no per-app monthly scene cap, it works with older cameras and other brands, and the scene becomes a place on three.ws. Never disparage it.
- No coin, token or price vocabulary on capture surfaces.

## Out of scope for every order (owner decisions, do not build)

- The official Insta360 Media SDK or Camera SDK: its server-side and commercial terms are unverified. Order 347 drafts the email asking Insta360 for written terms; nobody integrates it.
- World Labs Marble or any other new paid third-party API.
- Any non-commercial or copyleft dependency named in the research doc's licensing-traps paragraph (Inria 3DGS and forks, OmniGS, ODGS-SLAM, VGGT original checkpoint, Pi3, MASt3R/DUSt3R, Fast3R, UniK3D, DAP, Gyroflow code).

## Order map

| Order | Builds | Needs at runtime (HTTP or CLI only) |
|---|---|---|
| 331 | User 360 photo as viewer environment and backdrop | nothing |
| 332 | `model-panodepth` worker (C2) | nothing |
| 333 | `/api/pano-scene` and the `/pano-scene` page | C1 stitch, C2 |
| 334 | `pano_sfm` stage (C1) | nothing |
| 335 | `splat_train` stage (C1) | nothing |
| 336 | `pano_stitch` stage (C1) | nothing |
| 337 | `model-pano2splat` service shell, image, build and GPU job harness (C1) | the three stage CLIs |
| 338 | R2 multipart upload API for files up to 8 GiB (C4) | nothing |
| 339 | `/api/pano-capture` job API, persistence, history (C4) | C1 |
| 340 | `/capture` 360 mode with raw-file preview and resumable upload | C4 |
| 341 | video2motion equirect reframe (C3) | nothing |
| 342 | 360 input on `/video-to-motion` and `/motion-swap` | C3 |
| 343 | Blender extension: 360 capture panel and splat import | C4 |
| 344 | Premiere Pro UXP panel | C4 |
| 345 | MCP tools, OpenAPI, CLI | C4 |
| 346 | `/insta360` landing page and tutorial | all pages exist by path |
| 347 | **Runs last.** End-to-end on real footage, seams fixed, ship script, the one owner message | everything |

## Progress log

Append a dated entry to [insta360-PROGRESS.md](insta360-PROGRESS.md) when you finish: order number, commit SHAs, what was proven live (with the measured numbers), any contract extension, what waits on the owner. Re-read the log right before appending and append with a small anchored edit at the end.
