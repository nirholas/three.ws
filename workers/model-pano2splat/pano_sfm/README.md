# pano_sfm

Turns a stitched equirect 360 video, or a folder of equirect photos, into a solved COLMAP rig dataset. It is stage C1 of the `model-pano2splat` worker. The splat trainer reads its output directly.

```
python -m pano_sfm --input clip.mp4 --out dataset/ [--fps 2 --max-frames 300 --views 8|12|14
                   --mask-operator --mask-sky --trim-start 0 --trim-end 30]
```

Output layout:

```
dataset/images/<frame:05d>_<view:02d>.jpg    90 degree perspective views, one rig per frame
dataset/masks/<image name>.png               only with --mask-operator or --mask-sky, white = keep
dataset/sparse/0/{cameras,images,points3D}.bin
dataset/sfm.json                             frames_used, views_per_frame, registered_images, total_images,
                                             registration_ratio, mean_reproj_error_px, points3d, duration_s,
                                             warnings, plus mapper, matcher, gravity, frame_selection, gpu
```

Progress is JSON lines on stdout (`{"stage": "frames", "progress": 0.5}`). Exit codes: 0 ok, 1 internal, 2 unsupported input, 3 corrupt or missing input, 4 quality. On failure the last stderr line is `{"error": ..., "message": ...}`. A registration ratio below 0.6 exits 4 with `too_few_registered`.

## How it works

1. `frames.py`: an ffmpeg analysis pass scores every sampled frame (Laplacian variance for sharpness, Farneback flow for near-duplicates), drops the blurry and static ones, then extracts the kept frames. At least half of the frames are always kept.
2. `geometry.py`: each equirect frame is resampled into 8, 12 or 14 pinhole views (90 degree field of view, SIMPLE_PINHOLE, focal length half the view size). Views of one frame share a camera centre, so they form one COLMAP rig. View 0 is the reference sensor.
3. `masks.py`: optional. `--mask-operator` segments the person with torchvision DeepLabV3-MobileNetV3 and caps the nadir for the selfie stick. `--mask-sky` is classical. Masks are written per view, white keeps.
4. `solve.py`: SIFT features (up to 8192 per image), `apply_rig_config` so the rig is a constraint, pairs inside one frame are skipped. Video uses sequential matching with loop detection. Photos use exhaustive matching up to 700 images, a vocabulary tree above that. The global mapper runs first. The incremental mapper runs only if the global one registers under 0.6.
5. `gravity.py`: the world is rotated so +Y is up, using the vertical vanishing direction found by RANSAC over line-segment normals. When there are too few vertical lines it falls back to the camera's own up axis and adds a warning.

Loop detection needs COLMAP's vocabulary tree. COLMAP aborts the whole process (`std::terminate`, uncatchable) when its own download of that file fails, so `resolve_vocab_tree` fetches it in Python, checks its sha256, and caches it. Set `PANO_SFM_VOCAB_TREE` to a local file to skip the download (the GPU proof image bakes it in). With no tree available, matching still runs and a warning says loops were not detected.

## Versions

COLMAP and pycolmap are both pinned to 4.2.1 (`requirements.d/pano_sfm.txt`; the GPU image uses `pycolmap-cuda12==4.2.1`). pycolmap 4.2 notes the code relies on: `apply_rig_config` takes `image_prefix` per camera, rig verification is on, and two-view geometry config 2 means calibrated.

## Measured results

Each row is one real clip, default 8 views, 2 fps. GPU rows ran as a Cloud Run Job (europe-west4, NVIDIA L4, driver 580.126.20, COLMAP 4.2.1 built with CUDA, image digest `sha256:0b0fde010220105e7992693a3bcac411b05b71fb83ae1384f33c865903c48a19`). `colmap model_analyzer --path sparse/0` loaded every GPU result and printed the same registered image and point counts as `sfm.json`.

| Clip | Camera, scene | Source size | Where | Frames | Registered | Ratio | Reproj px | Points | Time | Mapper |
|---|---|---|---|---|---|---|---|---|---|---|
| Moscow metro interior (CC0) | spherical camera, indoor | 3840x1920 | GPU, execution `pano-sfm-proof-rs6m8` | 48 | 384 / 384 | 1.000 | 1.096 | 11,738 | 187 s | global |
| Moscow metro interior (CC0) | same clip | 3840x1920 | CPU, local | 37 | 296 / 296 | 1.000 | 1.105 | 8,875 | 401 s | global |
| Hof, Insta360 X6 (CC BY-SA 4.0) | Insta360 X6, outdoor | 7680x3840 | GPU, execution `pano-sfm-proof-5mzvv` | 102 | 816 / 816 | 1.000 | 0.520 | 196,255 | 874 s | global |
| Norah Head tour, Insta360 X5 (CC BY 3.0) | Insta360 X5, outdoor | 7680x3840 | GPU, execution `pano-sfm-proof-dcns4` | 150 | 1024 / 1200 | 0.853 | 0.866 | 69,815 | 1,309 s | global |
| 20 stills from the metro clip | photo mode, indoor | 3840x1920 | CPU, local | 20 | 160 / 160 | 1.000 | 1.043 | 5,647 | 468 s | global |
| Metro with `--mask-operator --mask-sky`, 20 frames | mask path | 3840x1920 | CPU, local | 20 | 160 / 160 | 1.000 | 0.618 | 4,360 | 402 s | global |

Three real videos were solved on the GPU and two reach 0.9 or better. Norah Head is a walking tour with long featureless stretches (sea, sky, bare rock), and 0.853 is the honest ratio for it. It is above the 0.6 gate, so the pipeline accepts it.

Cases that did not solve, kept here because they set the limits:

- NASA mission-control 360 clip: 3840x2048 is not 2:1, so the stage refuses it with `not_equirectangular` and exit 2 (GPU execution `pano-sfm-proof-qngrh`, 4 s). That is the designed rejection, not a failure to solve.
- Old Ghost Road walkaround (4096x2048, 868 MB): the GPU job failed to start an execution twice in this session before reaching the stage. Not measured.
- Gunsan house, 12 equirect photos (7680x3840, KOGL Type 1): exit 4. There are only 12 photos, taken at wide spacing inside a house, and COLMAP found no usable tracks at 8 views (28 minutes on CPU). A retry with 14 views also exits 4 with `too_few_registered`. The stage reports it correctly and gives the walk-slower message. These photos need denser capture.

## Photo sets

No permissively licensed single-scene set of 20 or more real equirect photos was found. The 20-photo row above is 20 frames pulled from the metro clip and fed through the photo path (exhaustive matching), so it proves the photo code path, not an independent photo capture. Real photo sets with fewer images exist and solve only when neighbouring shots overlap heavily.

## Tests

`tests/test_pano_sfm.py` (26 tests, 1 skipped unless `PANO_SFM_TEST_OUTPUT` points at a real output) runs against six real 768x384 frames in `tests/fixtures/pano_sfm/` (CC0, see its README). From `workers/model-pano2splat`:

```
python -m pytest tests/test_pano_sfm.py
```
