# model-video2motion

Video of a person to a **retargetable animation clip + body-swap plates**. A
CPU-only FastAPI worker (no GPU needed, deploys like the segment/rembg lanes) that
powers the **Motion Swap** page (`/motion-swap`): upload a video of yourself,
get it back with your avatar performing your motion. The same capture path
produces the lexical clips behind sign-language playback (`src/sign-speech.js`),
which is why hand articulation is solved as carefully as the body.

## What it produces

For one input video, four artifacts land in GCS under `motion-swap/<task_id>/`:

| Artifact | What it is |
|---|---|
| `clip.json` | three.js `AnimationClip.toJSON()` on the canonical Wolf3D skeleton, the SAME document shape the animation library and `model-text2motion` serve, so it retargets onto any rigged avatar via `src/animation-retarget.js` |
| `video.mp4` | the normalized source (long edge capped to 1280, capped fps/duration, audio kept, source metadata stripped) |
| `mask.mp4` | grayscale per-frame person mask aligned with `video.mp4` |
| `meta.json` | `version`, `fps`, `frames`, `width`, `height`, and per-frame screen `anchors` (hip position `x`/`y`, subject height `h`, visibility `v`) for pinning the avatar over the subject |

The browser compositor does the rest: original footage underneath, subject
pixelated via the mask, avatar retargeted onto the clip and pinned per frame.

## Models (all Apache-2.0, baked into the image)

- **MediaPipe PoseLandmarker (heavy)**: 33 world landmarks per frame, VIDEO
  mode with tracking.
- **MediaPipe HandLandmarker**: 21 landmarks per hand, up to 2 hands, VIDEO
  mode with tracking.
- **MediaPipe ImageSegmenter (selfie multiclass 256x256)**: the person mask is
  `1 - background confidence`, which holds up far better than the single-class
  selfie model on wide framing (house tours, rooms).

The landmark to joint-rotation solve is ours: `pose_solver.py` builds global
orientations for pelvis/chest/head from body lines, solves each limb with its
bend-plane to fix twist, converts to locals against the parent chain via
hierarchical FK in the canonical rig convention, and emits
hemisphere-continuous quaternion tracks. Pure NumPy, unit-tested from synthetic
poses (`test_pose_solver.py`) without mediapipe installed.

When hands are visible, the solver also emits full hand articulation: detected
hands are assigned to the subject's left/right side by proximity to the pose
wrists (the model's handedness label is only a mirrored-convention fallback),
the wrist gets a palm-frame orientation (fixing twist the body-only solve
cannot see), and all 30 canonical finger bones (`LeftHandIndex1` through
`RightHandThumb3`) are solved as hinge rotations per frame. A frame that loses
hand tracking holds the previous finger pose instead of snapping to rest. This
is what makes fine-gesture and sign-language capture work: a video of a signer
comes back as a clip whose handshapes retarget onto any rigged avatar.

## API

```
POST /infer        { video_url, fps?=24, max_seconds?, job_id? }  → 202 { task_id, status }
GET  /tasks/:id    → { status, result_url?, meta_url?, video_url?, mask_url?, frames?, fps?, error? }
GET  /health       → { ok, models_loaded }
```

`fps` is clamped to 8..30 by request validation; `max_seconds` is clamped down
to `MAX_SECONDS`. `job_id`, when supplied, becomes the task id, which lets a
caller choose its own correlation id; the platform does not send one and simply
polls the `task_id` it got back. `status` moves `queued` to `running` to `done`
or `failed`; a failure carries an opaque `error` string with a correlation id
that matches the server log line.

Bearer auth on `/infer` and `/tasks/:id` (`Authorization: Bearer $API_KEY`);
`/health` is unauthenticated so uptime checks need no secret. Input is fetched
through the SSRF-hardened `worker_security.fetch_remote_bytes` (https-only,
private/loopback/metadata IPs rejected, redirect hops re-validated), capped at
256 MiB, and processing is capped at `MAX_SECONDS` (default 90).

The platform reaches this worker through the GCP provider's `video2motion`
mode (`GCP_VIDEO2MOTION_URL`), exposed as `POST /api/motion-swap`
(+ `GET /api/motion-swap?job=<id>`).

### 360 footage (`projection: "equirect"`)

`POST /infer` also takes `projection` (`"perspective"` default, unchanged
behaviour, or `"equirect"`) and `subject` (`{yaw_deg: -180..180, pitch_deg:
-90..90}`, the direction toward the person; optional). With `equirect` the input
must be a stitched 2:1 equirectangular video (`yaw = (x/W - 0.5) * 360`, `pitch
= (0.5 - y/H) * 180`, so yaw grows to the right and pitch grows up). The worker
finds the person on the sphere, renders a 1080p perspective reframe that follows
them, runs the unchanged pose pipeline on that reframe, and returns the usual
artifacts plus:

| Field | What it is |
|---|---|
| `reframe_url` | `reframe.mp4`, the 1920x1080 perspective video the pose pass ran on (audio kept) |
| `subject_track` | `[{t, yaw_deg, pitch_deg, fov_deg}]`, one entry per output frame: where the reframe camera looked |
| `track_stats` | `source_width/height`, `frames`, `lost_frames`, `reacquisitions`, `acquisition` (method, yaw, pitch, body height in degrees), `track_seconds`, `reframe_seconds` |

`meta.json` gains `"projection": "equirect"`. The solved root orientation is
world-space: camera-space landmarks are rotated back into the 360 camera's frame
with the track (`equirect.compensate_camera_rotation`), so a person walking a
circle around the camera does not turn into a person spinning in place.

How it works (`equirect.py`, all pure NumPy plus OpenCV):

1. **Working copy.** The source is decoded once to a 3840-wide copy (override
   with `EQUIRECT_WORK_WIDTH`) and read twice, tracking then rendering, so a
   5.7K source never sits in memory.
2. **Acquire.** With a `subject`, tracking starts there. Without one, six
   overlapping 100 degree cube-face renders are scanned with MediaPipe pose, boxes
   within 15 degrees are merged, and the largest upright, moving person wins. A
   sideways copy of a close subject (two-lens stitch seam) is discounted by torso
   tilt so it cannot outrank the real person.
3. **Track.** Each frame detects inside a perspective crop at the predicted
   direction. A constant-velocity Kalman filter runs on unwrapped angles, so the
   +/-180 degree seam is not special, then an RTS smoother removes jitter. After
   more than 10 lost frames the cube-face scan retries every 5 frames and takes
   the candidate nearest the prediction.
4. **Frame.** Field of view adapts to the body so it fills about 62% of the
   frame height, clamped to 50..110 degrees, and is smoothed.

Limits, measured on real footage: the tracker has no appearance model, so when
the subject leaves the frame for good it follows whoever it re-acquires (a
stranger, even a mannequin); pass `subject` and a shorter `max_seconds` for such
clips. Close-ups can fill most of the sphere, which pushes the field of view to
its 110 degree ceiling. Detection (MediaPipe) is CPU work: a Cloud Run L4 job
tracked a 12 s, 24 fps, 3840x1920 clip in about 65 s and rendered it in about 57
s (see `scripts/video2motion-equirect-gpu/` for the harness and the measured table
in `prompts/finish/_context/insta360-PROGRESS.md`).

### Environment

| Var | Default | Purpose |
|---|---|---|
| `API_KEY` | required | bearer secret for `/infer` and `/tasks/:id` |
| `GCS_BUCKET` | required | output bucket for the four artifacts |
| `MAX_CONCURRENT` | `2` | in-flight captures per instance |
| `MAX_SECONDS` | `90` | hard cap on processed duration |
| `MODELS_DIR` | `/models` | directory holding the three model bundles |

Startup fails fast if any bundle is missing from `MODELS_DIR`.

## Deploy

```bash
gcloud builds submit --config workers/model-video2motion/cloudbuild.yaml \
  --region us-central1 --project aerial-vehicle-466722-p5 \
  --substitutions=SHORT_SHA=manual$(date +%s)
```

Then point the API at it:

```bash
gcloud run services update three-ws-api --region us-central1 \
  --update-env-vars GCP_VIDEO2MOTION_URL=$(gcloud run services describe \
    model-video2motion --region us-central1 --format='value(status.url)')
```

Shares the `avatar-reconstruction-key` bearer secret (`GCP_RECONSTRUCTION_KEY`
on the API side) with the other reconstruction-family workers.

**The instance count is load-bearing, not a cost setting.** The service runs
`--min-instances=1 --max-instances=1 --no-cpu-throttling`. Capture happens in a
FastAPI background task after the 202 returns, so request-based billing starves
it (a 30 s clip took 3.5 h wall in production versus 3 min unthrottled, measured
2026-07-19); `min 1` stops the instance being reaped between polls, and `max 1`
keeps the in-memory task store authoritative, so a poll always lands on the
instance running the job. Raising `max-instances` would make `/tasks/:id`
return 404 for live jobs.

## Tests

The solver tests need only NumPy. The service tests additionally need ffmpeg
and the worker's own requirements:

```bash
cd workers/model-video2motion
python -m pytest test_pose_solver.py test_service.py -q
```

`test_service.py` covers the paths around the solver with real ffmpeg and real
MediaPipe: the HTTP auth/validation contract, video normalization (fps,
duration, long-edge and metadata handling), mask-video encoding and decode
round-trip, the SSRF guard on the caller-supplied URL, the queue to
task-store failure path, and a real three-model pass over a generated video.
The MediaPipe test skips unless the bundles are staged; point `MODELS_DIR` at a
directory holding all three, or run the suite inside the image, which already
has them:

```bash
docker build -t model-video2motion:local workers/model-video2motion
docker run --rm -v "$PWD/workers/model-video2motion:/src" -w /src \
  -e API_KEY=test -e GCS_BUCKET=test model-video2motion:local \
  sh -c 'pip install -q pytest && python -m pytest test_pose_solver.py test_service.py -q'
```

The 360 geometry, filter, tracker and compensation tests (`test_equirect.py`) run
on synthetic spheres and a recorded real track (`fixtures/equirect_track.json`).
Two further `test_service.py` cases run `_process` on real footage and skip
unless you point them at clips: `V2M_PERSPECTIVE_CLIP` (a clip of a person, the
perspective regression) and `V2M_EQUIRECT_CLIP` (a stitched 2:1 clip). Both need
the three MediaPipe bundles. `local_equirect.py <equirect.mp4> <out_dir>` runs
the same equirect code path with no server and no GCS and writes `reframe.mp4`,
`subject_track.json`, `clip.json` and `stats.json`.

## Local development

`local_solve.py` runs the same pose and hand pipeline as the server (minus
segmentation, GCS and HTTP) straight to a `clip.json`, which is the fast loop
for changing `pose_solver.py`:

```bash
python local_solve.py input.mp4 out_clip.json --fps=24 --dump-landmarks=lm.npz
```

It reads bundles from `$MODELS_DIR` (default `./.models`, where the pose and
hand bundles are checked in). Stage any missing bundle from the same public
URLs the Dockerfile uses:

```bash
curl -fsSL -o .models/selfie_multiclass_256x256.tflite \
  https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite
```

### Verify a real capture

The pytest suite deliberately stops short of GCS uploads and real human
footage. To prove the whole path, run the image against a live video URL with
credentials mounted (any public https video of a person works; a previous
capture's normalized `video.mp4` is a convenient one):

```bash
docker run --rm -p 8080:8080 \
  -e API_KEY=local-key -e GCS_BUCKET=three-ws-avatar-reconstructions \
  -e GOOGLE_APPLICATION_CREDENTIALS=/adc.json \
  -v "$HOME/.config/gcloud/application_default_credentials.json:/adc.json:ro" \
  model-video2motion:local

curl -s localhost:8080/infer -H 'Authorization: Bearer local-key' \
  -H 'content-type: application/json' \
  -d '{"video_url":"https://storage.googleapis.com/.../video.mp4","fps":12,"max_seconds":6}'
curl -s localhost:8080/tasks/<task_id> -H 'Authorization: Bearer local-key'
```

`status: "done"` carries the four artifact URLs. Capture is CPU-bound and runs
around 6x the clip's own length on the deployed 8-core instance (a 6 s clip at
12 fps, 72 frames, took 37.9 s end to end including fetch and upload, measured
against the live service 2026-08-11; the 30 s clip behind
`MODE_ETA.video2motion = 120` in `api/_providers/gcp.js` lands in the same
ratio).

## Fleet facts (2026-11-27)

Checked against the code and the `three-ws-api` service env for the Forge fleet audit (`docs/ops/gcp-model-workers.md`).

- **Serves:** Video to motion capture (`GCP_VIDEO2MOTION_URL`, mode `video2motion`).
- **Production:** Wired: `GCP_VIDEO2MOTION_URL` is set.
- **GPU and memory:** CPU only (no GPU): 8 vCPU, 16 GiB.
- **Cold start:** The MediaPipe bundles are baked into the image and startup only checks they exist, so a cold start is the container boot. Repo default `_MIN_INSTANCES` is "1"; the live floor is 0 since the owner's 2026-11-25 spend cut, so pass `--substitutions=_MIN_INSTANCES=0` on a redeploy unless the owner has approved a warm floor.
- **Deploy:** `gcloud builds submit --config workers/model-video2motion/cloudbuild.yaml .` (see Deploy above).
