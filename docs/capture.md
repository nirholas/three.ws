# Scene Capture: video to explorable 3D point cloud

Scene Capture turns a phone video of any space into an explorable 3D point cloud you can orbit in the browser. Film a room, a street, or an object, hand it a public video URL, and a streaming feed-forward reconstruction fuses the frames into a coloured `.ply` that renders live with WebGL. Already have a point cloud? Drop it in or paste a URL and skip straight to the viewer.

Page: [/capture](https://three.ws/capture) · API: `/api/scene-capture`

## Why it exists

Photogrammetry and SLAM traditionally mean an offline pipeline: extract frames, match features, bundle-adjust, and wait. Scene Capture collapses that into a single feed-forward pass: no per-scene optimization, no manual camera poses, just frames in and dense world-space geometry out. It is the fastest way to go from "I filmed this place on my phone" to "I can orbit this place in my browser," and because the output is a standard coloured `.ply`, it drops into any point-cloud tool afterward.

## How it works

The endpoint (`api/scene-capture.js`) routes to `workers/model-video2scene`, a Cloud Run GPU worker running **LingBot-Map**, a feed-forward Geometric Context Transformer that reconstructs dense world-space geometry directly from video frames. The worker and its model weights are ready; the service itself is not deployed yet, so as of 2026-11-04 `/capture` runs the unconfigured path described below (sample cloud plus bring-your-own `.ply`) until `GCP_VIDEO2SCENE_URL` is set. You submit a public https URL to an mp4, mov, or webm; the handler resolves and validates the host itself (rejecting private, loopback, and metadata IPs as defense in depth against SSRF) before handing the URL to the worker. Submission returns `202 { job_id, status, eta_seconds }`, and the browser polls `GET /api/scene-capture?job=<id>` until the worker returns a `result_url` for the finished `.ply`, along with `num_points` and `frames`.

Reconstruction exposes real, clamped sampling knobs:

| Param | Range | Default | What it controls |
| --- | --- | --- | --- |
| `mode` | `streaming` / `windowed` | `streaming` | Continuous streaming fusion, or fixed-window batches. |
| `fps` | 1-30 | 8 | Frames sampled per second of video. |
| `keyframe_interval` | 1-64 | 4 | Spacing between keyframes. |
| `num_scale_frames` | 2-16 | 8 | Frames used to resolve metric scale. |
| `window_size` | 16-512 | 128 | Frame window for the windowed mode. |
| `conf_percentile` | 0-95 | 30 | Confidence floor for keeping a point. |
| `max_points` | 50k-3M | 1.5M | Cap on total output points. |
| `voxel_size` | 0-10 | 0 | Optional voxel downsampling. |
| `mask_sky` | bool | true | Drop sky pixels so open scenes don't fill with noise. |

One job covers 512 frames, which is 64 seconds at the default `fps: 8`. Fusion holds every pixel of every frame in memory at once, so the cap is host RAM, not model capability: film longer and lower `fps` rather than expecting a longer clip to be reconstructed whole. A longer input is reconstructed up to the cap, and the poll response carries `frames_truncated: true` so a partial scene never reads as the whole clip.

The result is a binary `.ply` the page renders client-side with a WebGL point-cloud viewer (`src/scene-capture.js` and `pointcloud-viewer.js`). Every state is designed: idle, submitting, processing (with an elapsed timer and stage hints), live, and error. There is no mock path: when the worker env (`GCP_VIDEO2SCENE_URL` and `GCP_RECONSTRUCTION_KEY`) is not configured, the endpoint returns a clean 503 and the page still proves the renderer end-to-end with a built-in sample room cloud. You can also load any `.ply` you already have by URL or file, so the viewer is useful even where reconstruction is offline.

## Walkthrough

1. Open [/capture](https://three.ws/capture).
2. Try the sample cloud first to confirm the viewer renders on your device.
3. To reconstruct, film a space, upload the video somewhere public, and paste its https URL. Slow, overlapping passes with good lighting reconstruct best.
4. Submit. A processing state shows the elapsed time and stage hints while the worker streams frames through LingBot-Map.
5. When the point cloud lands it renders live: orbit, zoom, and pan. The HUD shows the point count.
6. Download the `.ply`, or load a different cloud by URL or file.

## Examples

Reconstruction is an async job over a public video URL.

```bash
# Start a reconstruction from a public video, then poll for the .ply.
JOB=$(curl -s -X POST 'https://three.ws/api/scene-capture' \
  -H 'content-type: application/json' \
  -d '{"video_url":"https://example.com/room-walkthrough.mp4","mode":"streaming","fps":8}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("job_id",""))')

curl "https://three.ws/api/scene-capture?job=$JOB"
```

Tune sampling for a denser cloud from a longer clip:

```bash
curl -X POST 'https://three.ws/api/scene-capture' \
  -H 'content-type: application/json' \
  -d '{"video_url":"https://example.com/street.mp4","fps":12,"keyframe_interval":6,"max_points":2500000,"mask_sky":true}'
```

Poll until the cloud is ready in JavaScript:

```javascript
const start = await fetch('https://three.ws/api/scene-capture', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ video_url: 'https://example.com/object-orbit.mp4' }),
}).then((r) => r.json());

let job = start;
while (job.status !== 'done' && job.status !== 'failed') {
  await new Promise((r) => setTimeout(r, 4000));
  job = await fetch(`https://three.ws/api/scene-capture?job=${start.job_id}`).then((r) => r.json());
}
console.log(job.result_url, job.num_points); // coloured .ply + point count
```

## States and limits

- **Input** is a public https URL to an mp4, mov, or webm. Private, loopback, and metadata hosts are rejected before the worker sees the URL.
- **Processing**: a real elapsed timer with stage hints, driven by the poll lifecycle, not a fake bar.
- **Unconfigured (503)**: when the video2scene worker env is absent, the page falls back to a sample room cloud so the renderer still works end-to-end. No fabricated reconstruction is ever shown. The 503 body splits its audience: `message` is what `/capture` renders for a visitor, `hint` carries the env-var instructions for whoever runs the deployment.
- **Error**: an invalid `.ply` reports "that isn't a valid point cloud" (including a file that decodes to zero vertices, which is what a non-PLY does rather than throwing); a blocked fetch explains the CORS limit; a job that stops answering gives up after eight consecutive unreadable polls or twenty minutes, whichever comes first, and says how to restart it.
- **Truncated clips**: when the poll returns `frames_truncated: true`, the viewer's HUD label says the clip was cut to the frame budget, so a partial scene is never presented as the whole video.
- **Point cap** defaults to 1.5M and tops out at 3M; `voxel_size` and `conf_percentile` trade density for cleanliness.
- **Client-side rendering**: the `.ply` is decoded and displayed in the browser with WebGL; very large clouds are bounded by your device's GPU and memory.
- Rate limits are per client IP on the shared 3D generation buckets.

## Step inside one 360 photo

A single equirectangular photo does not need a walkaround. [/pano-scene](https://three.ws/pano-scene) takes a 360 JPEG or PNG (exactly twice as wide as tall, up to 120 MB) or a raw `.insp` file, estimates metric depth for every pixel of the sphere, and builds one textured shell around the camera. The page uploads through `/api/scene-upload`, submits `POST /api/pano-scene`, polls `GET /api/pano-scene?job=<id>` and shows the real stage (Upload, Stitch for `.insp`, Depth, Mesh, Done). The result is a GLB and PLY you can download, plus an in-page viewer where you drag to look around, press W A S D or Step to move a short way off-centre (limited by the scene's median depth, since a single photo cannot show what is behind surfaces), and use the phone gyroscope. Signed-out visitors are sent to sign in; if the depth worker is not switched on the page says so before you upload. Tests: `tests/pano-scene-page.test.js` (file rules, stage model, camera maths), `tests/scene-upload-pano.test.js` (image and `.insp` presign).

## 360 video mode

[/capture](https://three.ws/capture) has two tabs, Standard video and 360 video (`/capture?mode=360`). Dropping a raw `.insv`, `.insp` or `.lrv` file, or any video exactly twice as wide as tall, on the Standard tab switches to 360 on its own. The 360 flow, from file to scene:

1. **Preview, instantly and locally.** A 2:1 video plays on a Three.js sphere you drag to look around (scroll or pinch to zoom, gyroscope on phones). A raw `.insv` is stitched in the browser by GyroView when the browser can decode HEVC; a split recording asks for the matching `_00` or `_10` file. Where the browser cannot do it the page says "Preview isn't available in this browser. Your file will still work; we stitch it on our servers." The preview never blocks the upload.
2. **Trim.** A timeline with thumbnails and two handles (arrow keys nudge a tenth of a second, Shift a second, Page Up and Page Down ten). The range is sent as `trim` with the job; the file is never cut in the browser.
3. **Quality.** Preview, Standard and High presets with a conservative time estimate that counts only the work after the upload.
4. **Upload.** Parts of a multipart upload go straight to storage, four at a time, with per-part retry, real byte progress, speed and time remaining, a Wake Lock and a leave-page warning. Reloading mid-upload and choosing the same file again resumes from the parts storage already holds (the start button reads "Resume upload"). The browser must be able to read the `ETag` response header from the bucket, so the bucket CORS rule needs `ExposeHeaders: ["ETag"]`.
5. **Job.** `POST /api/pano-capture` with the uploaded `source_url`, then a staged view (Upload, Stitch for raw files, Frames, Camera solve, Training, Export) polled from `GET /api/pano-capture?job=<id>`; polling slows when the tab is hidden. The page tells you that you can close the tab; the scene is waiting under Your captures. The job id lives in the URL, so a link returns to the same job.
6. **Result.** An inline splat viewer, the preview clip with Share, SPZ and PLY downloads, and Open in /splat.

Your captures lists past jobs with a poster, status, Open, Retry and Delete (confirmed in the page). The same scenes show on [/mine](https://three.ws/mine) under the 360 scenes filter: a finished one opens in `/splat`, an unfinished one opens its job view on `/capture`, and a failed one offers Capture again.

### The capture job behind it

A capture is a row in `pano_captures` owned by the account that started it, so history, resume and Delete work across devices. `POST /api/pano-capture` stores the job and hands it to the pano2splat worker (contract C1, `GCP_PANO2SPLAT_URL`); each poll asks the worker for the task's state, at most once per 5 seconds per job however many tabs poll. When the worker reports success, the API streams the PLY, SPZ, flythrough and poster from the worker's 7-day signed URLs into platform storage under `captures/pano/<user>/<job>/` (a 15-minute lease makes sure only one instance copies), records each file's size and SHA-256, and only then marks the job succeeded. While R2 refuses the platform credential, files land in the GCS fallback bucket and the job records which store holds each one, so Delete removes them from the right place. The cron `/api/cron/pano-captures` runs every 5 minutes and advances any active job nobody polled for a minute, so closing the tab never strands a scene. Two captures per account can be processing at once. Request and response shapes: [API reference](./api-reference.md#360-video-to-splat-scene-api).

Tests: `tests/pano-capture.test.js` runs the endpoint, the finaliser, the cron and the migration on an isolated in-process Postgres against a server speaking contract C1. Live proof on real files: `node scripts/pano-capture-live-check.mjs --leg r2 --ply <file> --spz <file>` copies real splat files through the production finaliser into the R2 bucket, reads every object back and compares SHA-256 with the source (`--leg fallback` does the same through the production credential and the GCS fallback). `scripts/pano-capture-live-server.mjs` runs the real server on an isolated database with a C1 stand-in, so `/capture` and `/mine` can be driven in a browser without touching production data. Every error code the upload and job APIs return has its own message and next step (sign in, wait for the daily quota, split a file over 8 GiB, retry, and so on). Tests: `tests/capture-360.test.js` (classification, pairing, trim, estimates, stage model, error copy) and `tests/multipart-upload.test.js` (the uploader). Browser proof: `scripts/capture-360-ui-proof.mjs`, run against `scripts/capture-upload-live-server.mjs` with `scripts/capture-360-live-worker.mjs` standing in for the GPU worker.

## Resumable upload for large capture files

`/api/scene-upload` is a single PUT capped at 512 MB. Raw 360 footage (`.insv`, `.insp`, `.lrv`) and stitched 8K video run to several gigabytes, so `/api/capture-upload` uploads them to R2 as an S3 multipart upload: the browser sends parts in parallel straight to storage (nothing passes through the API server), a dropped connection loses one part instead of the whole file, and a resumed upload asks storage which parts already arrived and sends only the rest. Details and request shapes are in the [API reference](./api-reference.md#capture-upload-api). Limits: 8 GiB per file, 3 uploads in progress per account, 32 GiB per account per day; accepted types are `video/mp4`, `video/quicktime`, `image/jpeg`, `image/png`, `image/x-exr`, and `application/octet-stream` for `.insv`, `.insp` and `.lrv` only. Unfinished uploads are aborted after 24 hours and raw files are deleted after 30 days by bucket lifecycle rules on `captures/raw/`. The finished object's `source_url` is a signed https URL valid for 7 days that the reconstruction workers fetch. Tests: `tests/capture-upload.test.js`; live proof: `scripts/capture-upload-live-proof.mjs` (2.19 GB through the four endpoints, process killed after 120 of 262 parts, resumed, SHA-256 identical on download).

## Related

- [Splat Viewer](./splat.md) renders Gaussian-splat radiance fields, the photoreal cousin of point clouds.
- [/avatar-engines](https://three.ws/avatar-engines) covers the Geometric Context Transformer and related capture engines.
- [Forge](./forge.md) and [Image to 3D](./image-to-3d.md) for generating meshes from prompts and photos.
- [/pano-scene](https://three.ws/pano-scene) turns one 360 photo into a shell you can stand inside.
- Pages: [/scene](https://three.ws/scene) (Scene Studio), [/create](https://three.ws/create).
