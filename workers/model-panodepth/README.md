# model-panodepth

One equirectangular 360 photo in, a metric depth shell out. Contract C2 of the insta360 campaign
([prompts/finish/_context/insta360-00-CONTEXT.md](../../prompts/finish/_context/insta360-00-CONTEXT.md)).

The worker runs MoGe-2 on the photo's panorama split, merges the per-view metric points into one
distance map (distance from the camera, in metres), and writes three files:

| File | What it is |
| --- | --- |
| `scene.glb` | A textured sphere-grid mesh around the camera (KHR_materials_unlit, the photo as texture). Depth discontinuities are cut open, so the shell shows disocclusion gaps from off-centre instead of stretched curtains. |
| `scene.ply` | Binary little-endian coloured point cloud, equal-area thinned so the poles are not oversampled. |
| `depth.exr` | Float32 distance in metres per pixel at the model's panorama resolution. 0 marks pixels the model rejected. |

## Model and license

[MoGe-2](https://github.com/microsoft/MoGe), checkpoint `Ruicheng/moge-2-vitl-normal` (ViT-L, metric scale, normals head).

- Code: MIT (repo README, "License" section). Weights: MIT (Hugging Face model card). The DINOv2 parts it
  carries are Apache-2.0. Read from the primary sources on 2026-11-21; the license text and model card
  are stored next to the weights at `gs://three-ws-model-weights/panodepth/moge-2-vitl-normal/`
  (`MOGE_LICENSE.txt`, `MODEL_CARD.md`, `SHA256SUMS`).
- The checkpoint SHA-256 is `280741fd09bc3f403ccff9967784c2a391b52d2c0742ae3efdb21d9f90cc1a01`. The image build
  refuses to finish when the baked file does not match.
- Pinned code: `microsoft/MoGe@74fbce054ebed49800de42d0ad0e83495065719a`,
  `utils3d-moge@62f09d58509485564e24d5d9f6aac9ee9ebc0c37`.
- The license string is returned in `stats.license` on every result.

## API

Bearer auth (`Authorization: Bearer $API_KEY`) on `/infer` and `/tasks/{id}`. `/health` is open.

```
POST /infer   { "image_url": "https://...", "job_id"?: "...", "max_points"?: 2000000, "mesh"?: true, "max_faces"?: 1500000 }
              -> 202 { "task_id": "..." }
GET  /tasks/{id}
              -> { status: "queued|running|done|error", progress, stage,
                   result?: { glb_url, ply_url, depth_url,
                              stats: { width, height, median_depth_m, points, faces, model, license, ... } },
                   error?: { code, message } }
GET  /health  -> { ok, gpu_available, model, weights_present, model_loaded }
```

`max_faces` is an extension of C2 (default 1.5 M, cap 4 M); everything else is the contract. URLs are 7-day V4
signed links to `gs://three-ws-pano-captures/depth/<task_id>/`. The task manifest is also written there, so a
status poll survives an instance restart. `image_url` goes through the shared SSRF guard (public https only,
`400 unsafe_url` otherwise). Error codes: `unsafe_url`, `fetch_failed`, `image_too_large`, `not_equirect`
(width:height must be 2:1, within 2%), `unsupported_image`, `internal`.

`stats` also carries `depth_width`, `depth_height`, `camera_model` (from EXIF), `metric_scale_factor`,
`valid_fraction`, `sky_fill_radius_m`, `mesh_grid`, `culled_faces`, `edge_ratio`, `depth_jump` and a `seconds` breakdown.

## Conventions

- Metres. glTF frame: +Y up, -Z forward (image centre), +X right, camera at the origin. The PLY uses the same frame.
- Yaw 0 / pitch 0 is the frame centre; yaw grows to the right. The seam is closed with a duplicate column whose
  `u > 1` and a REPEAT sampler, so there is no gap or texture jump at the wrap.
- Texture is capped at 8192 x 4096 (JPEG q90).
- Pixels the model marks invalid (sky) are filled with a dome at a radius just past the farthest valid surface, so
  the shell is closed; the radius is reported as `sky_fill_radius_m`.

## How the depth is made

MoGe-2 is a perspective model, so the photo is split into 20 icosahedron views at 90 degrees, each view gets metric
points, and `moge.utils.panorama` merges the per-view distances with a log-distance Poisson solve. That merge has an
arbitrary global scale. The worker recovers the metric scale as the median of
(per-view log metric distance warped to the panorama) minus (merged log distance), and reports it as
`metric_scale_factor`.

## Tuning

`EDGE_RATIO = 8` and `DEPTH_JUMP = 0.12` in [shell_mesh.py](shell_mesh.py). Checked on the five GPU verify photos
by rendering the GLB shells from the origin and from 1 m off-centre. Foliage, rooflines and car edges open clean
disocclusion gaps with no stretched curtains, and floors and walls stay closed. Culled faces were 0.3% (small
office) to 2.6% (stitched square) of the mesh.

## Environment

| Variable | Meaning |
| --- | --- |
| `API_KEY` | Required bearer secret. |
| `RESULT_BUCKET` | Bucket for results (`three-ws-pano-captures`). Unset writes to a local temp dir (dev only). |
| `WEIGHTS_PATH` | Checkpoint, default `/weights/panodepth/moge-2-vitl-normal/model.pt`. |
| `MAX_CONCURRENT` | Parallel inferences per instance, default 1. |
| `PANODEPTH_DEVICE` | Force `cpu` or `cuda`. |

The runtime service account (`three-ws@`) needs object write on the result bucket and `iam.serviceAccountTokenCreator`
on itself, which `signBlob` uses to mint the signed URLs.

## Build and verify

```bash
# Build and push (does not create a service). Weights are copied in from the weights bucket by the first step.
TMPDIR=/home/user/.cache/gcloud-tmp gcloud builds submit workers/model-panodepth \
  --config workers/model-panodepth/cloudbuild.yaml --region europe-west4 --project aerial-vehicle-466722-p5 \
  --substitutions _REGION=europe-west4,_WEIGHTS_BUCKET=three-ws-model-weights-euw4

# GPU proof as a Cloud Run job: runs verify.py over real photos in the fixtures bucket
gcloud run jobs deploy panodepth-verify --image <image@digest> --region europe-west4 \
  --service-account three-ws@aerial-vehicle-466722-p5.iam.gserviceaccount.com \
  --gpu 1 --gpu-type nvidia-l4 --cpu 8 --memory 32Gi --no-gpu-zonal-redundancy --task-timeout 3000 --max-retries 0 \
  --command python --args verify.py \
  --set-env-vars "^@^VERIFY_OBJECTS=insta360/<a>.jpg,insta360/<b>.jpg@RESULT_BUCKET=three-ws-pano-captures@VERIFY_STAMP=<date>@API_KEY=verify"
gcloud run jobs execute panodepth-verify --region europe-west4
```

Tests: `cd workers/model-panodepth && python -m pytest tests` (shell geometry, culling on a real committed depth map,
auth, SSRF, aspect check). The image build runs them too.

## Deploy (owner step, order 347)

```bash
gcloud run deploy model-panodepth \
  --image europe-west4-docker.pkg.dev/aerial-vehicle-466722-p5/model-panodepth/server@<digest> \
  --region europe-west4 --project aerial-vehicle-466722-p5 \
  --service-account three-ws@aerial-vehicle-466722-p5.iam.gserviceaccount.com \
  --gpu 1 --gpu-type nvidia-l4 --no-gpu-zonal-redundancy --cpu 8 --memory 32Gi \
  --concurrency 1 --timeout 900 --min-instances 0 --max-instances 2 --no-allow-unauthenticated \
  --set-env-vars "RESULT_BUCKET=three-ws-pano-captures" --set-secrets "API_KEY=<secret>:latest"
```

## Latency

Measured on one NVIDIA L4 in europe-west4 (see the verify numbers in
[prompts/finish/_context/insta360-PROGRESS.md](../../prompts/finish/_context/insta360-PROGRESS.md)): about 9.5 s model
load once per instance, 2 s of inference, then the panorama merge (a CPU sparse solve) dominates at 53 to 101 s.
`merge_s` scales with how much of the sphere is valid.
