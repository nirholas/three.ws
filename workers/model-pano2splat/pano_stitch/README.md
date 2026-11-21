# pano_stitch

Turns raw Insta360 `.insv` video and `.insp` photo files into level equirect video (`equirect.mp4`) or a photo (`equirect.jpg`). It reads the per-unit lens calibration and the IMU from the file trailer, so it needs no vendor SDK and no stitched export.

```
python -m pano_stitch --input <file.insv[,file2.insv] | file.insp> --out <dir> \
    [--level-horizon] [--max-width 7680] [--trim-start S] [--trim-end S] [--backend auto|cpu|cuda]
```

Outputs in `--out`: `equirect.mp4` or `equirect.jpg`, and `stitch.json` with `camera_model, lens_layout (two_track | side_by_side | split_pair), calibration_model (equidistant | mei | mei_r5), width, height, fps, duration_s, frames, horizon_leveled, imu_samples, warnings[]`. Progress goes to stdout as JSON lines `{"stage", "progress"}`. Exit codes: 0 success, 1 internal, 2 unsupported input (`unsupported_camera` names the model string, also `no_insta360_trailer`, `bad_pair`, `no_calibration`), 3 corrupt or unreadable input. On failure the last stderr line is one JSON object `{"error", "message"}`.

`--trim-end` is seconds removed from the end. Trimming seeks and stops the decoder, so the unused part is never decoded or encoded. A split pair is passed as two comma separated paths in any order (paired by name, falling back to trailer presence when names were lost).

## Pipeline

1. `trailer.py` reads the 72 byte tail (magic `8db42d694ccc418790edff439fe026bf`), walks records backwards (X3 and older) or through the index record (X4 and later), and decodes the metadata protobuf, the IMU record and the exposure record.
2. `calibration.py` builds the lens model: V1 equidistant, V3 Mei (3 radial, 2 tangential terms), V6 Mei with 5 radial, tangential and thin-prism terms. The richest one present wins.
3. `layout.py` probes with ffprobe, gates the camera model (X, ONE X/X2, ONE R/RS, any X-series; GO and Ace are rejected) and detects the layout.
4. `imu.py` is an own complementary filter (gyro integration, accelerometer tilt correction only while |a| is 0.85 to 1.15 g, tilt time constant 1.5 s). The heading is the unwrapped yaw smoothed with a 1.2 s Gaussian, so the view follows the walk instead of locking to north. Frame time comes from the exposure record, IMU time is shifted by the gyro offset in the metadata.
5. `stitch.py` warps both fisheyes through a coarse ray grid (step 8, bilinear upsample), feathers with `1 - smoothstep(85, 95 deg)`, and matches exposure per channel from the overlap (running mean, 0.15). CPU uses OpenCV, CUDA uses PyTorch `grid_sample` when torch sees a GPU.
6. `video.py` pipes frames to ffmpeg: H.265 10-bit for 10-bit sources, otherwise H.264, NVENC variants when the backend is CUDA and ffmpeg has them, audio copied as AAC from the first file. `photo.py` writes quality 95 JPEG, copies EXIF (including the Exif and GPS sub-IFDs), adds GPano XMP.
7. `tilt.py` is the measuring tool used below: it finds verticals as great-circle planes (Hough lines in eight rectilinear views, IRLS plane fit) and reports the tilt of the frame from true vertical.

## Supported models

| Model | Layout | Calibration | Evidence |
|---|---|---|---|
| X3 | split pair `_00_` / `_10_` | mei (V3) | Real stitched output on Zenodo 21611765 (RITMO, CC BY 4.0), 2880x2880 H.264 per lens, 29.97 fps. Seamless, level. CPU and L4 GPU. |
| X5 | one file, two HEVC tracks 3840x3840 | mei_r5 (V6) | Real stitched output of a public 25 fps motorbike clip. Seam clean at 1920 and 3840 wide. CPU and L4 GPU. Committed trailer fixture `x5_indexed.insv` (MIT, GyroView) parses. |
| ONE R | side by side / equidistant (V1) | equidistant | Trailer and calibration parse verified on the MIT fixture `onerr_sample.insv`. Parser ready, unverified on real footage. |
| X4, X6, ONE X2, ONE RS | as X5 or X3 | V3 or V6 | Parser ready, unverified on real footage (no public raw file found). |
| `.insp` photos | two fisheyes side by side plus trailer | any | Tested end to end on a synthetic JPEG with a real X5 trailer (EXIF, GPS and GPano checked). No raw `.insp` found publicly, so unverified on real footage. |

Samples wanted for the unverified rows: drop the raw file in `gs://three-ws-capture-fixtures/insta360/`.

## Measured results

Cloud Run Job on one NVIDIA L4 (`europe-west4`, 8 vCPU, 32 GiB, torch 2.5.1+cu121, execution `pano-stitch-proof-xfsvg`, throwaway image `sha256:0e172bf2009166934016f9e248b7457c544d1c039f667128f0d884eeff9768c0`, deleted afterwards). The same job ran the CPU and the CUDA backend, `--level-horizon`. The X5 clip is 2.44 s, the X3 clip 5.31 s, so the seconds per minute below are dominated by start-up and the libx264 encode, and a long clip will be somewhat better.

| Model | Width | CPU (8 vCPU) wall s / s per min of footage | CUDA wall s / s per min |
|---|---|---|---|
| X3 | 1920x960 | 48.9 / 553 | 21.4 / 242 |
| X3 | 3840x1920 | 124.8 / 1412 | 44.8 / 506 |
| X5 | 1920x960 | 84.7 / 2083 (cold read of the 600 MB file from the bucket) | 13.2 / 325 |
| X5 | 3840x1920 | 46.0 / 1130 | 17.4 / 428 |

CPU against CUDA output of the same X3 clip: PSNR 46.1 dB average (Y 45.0, min 44.8) over 112 frames. The CUDA path still encodes with libx264 because the distro ffmpeg has no NVENC, so a GPU does not make the encode faster until the worker image (order 337) ships an NVENC ffmpeg.

### Horizon levelling

Tilt of the output measured with `python -m pano_stitch.tilt` on frames taken every 2 s (X3) or 0.24 s (X5):

| Clip | Without `--level-horizon` | With `--level-horizon` |
|---|---|---|
| X3, 30 s, held steady at a few degrees of tilt (16 frames) | mean 3.31 deg (2.3 to 3.8) | mean 1.49 deg over 14 frames (0.36 to 2.78). One frame read 11.1 deg with 8 segments and one found no verticals. |
| X5 motorbike, 2.4 s, 3840 wide | mean 16.3 deg of roll plus pitch (12.3 to 30.4) | mean 11.9 deg (11.1 to 12.6, one 29.3 outlier) |

Judgment on the X5 row: on a banked motorbike the accelerometer reads apparent gravity along the lean, so a gravity filter correctly keeps the lean in the horizon. That is physics, not a filter fault, and the clip is not a handheld walk. The X3 clip is the cleaner proof (55 percent less tilt). No public handheld clip with raw IMU exists that we could redistribute; the owner can drop one into the fixtures bucket to refresh these numbers.

### Blend

Feather versus a 5 level Laplacian multiband blend on one real frame per model (ratio of high-frequency energy in the overlap band to its flanks; higher keeps more detail): X3 0.693 vs 0.776, X5 0.763 vs 0.883. Multiband keeps 12 to 16 percent more detail in the band but also cannot hide parallax, so it duplicates edges instead of softening them, and no visible seam was removed in either clip. Feather stays the default, with no extra cost.

## References and licenses

Read for the format and the lens model only. No code was copied.

| Reference | Commit | License |
|---|---|---|
| freeKC/raw360-formats | 4dfecaad219e2f72b98d884cac596d2f31717448 | MIT |
| alexvaut/insv-stitch | eb94d02869751fe3aaeb5e2ed159a753cd46fe59 | MIT |
| insta360-stitch | 1a52f95f2d406a322d6eed631b0272a498c0a162 | MIT or Apache-2.0 |
| telemetry-parser | 7ab3b3d81b0def1ad849d3870470e2cb5bf89321 | MIT or Apache-2.0 |
| GyroView test fixtures (trailer files) | n/a | MIT |

Gyroflow (GPL) and the Insta360 Media SDK were not read or used. Trailer fixtures and their licenses are in `tests/fixtures/insta360/LICENSES.md`. Insta360 is named only to say which cameras files came from; this is not an endorsement or partnership.

## Tests

`workers/model-pano2splat/tests/test_pano_stitch.py` (35 tests: trailer layouts, lens math, pairing, levelling, tilt estimator, exit codes and stderr JSON, `stitch.json` schema, end-to-end video and photo). Pinned dependencies are in `requirements.d/pano_stitch.txt`:

```
cd workers/model-pano2splat && python -m pytest tests/test_pano_stitch.py
```
