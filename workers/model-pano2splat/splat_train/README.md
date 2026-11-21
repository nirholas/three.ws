# splat_train

The `splat_train` stage of the `model-pano2splat` worker. It trains a Gaussian splat from a COLMAP
dataset and renders a flythrough preview. Contract C1 in `prompts/finish/_context/insta360-00-CONTEXT.md`.

```
python -m splat_train --colmap <dir> --out <dir> [--preset preview|standard|high]
    [--iterations 30000] [--max-gaussians 3000000] [--preview-video] [--holdout-every 8]
```

Input: a COLMAP dataset (`images/`, optional `masks/<image name>.png`, `sparse/0/` in binary or text
form). Camera models `SIMPLE_PINHOLE`, `PINHOLE`, `SIMPLE_RADIAL`, `RADIAL` and `OPENCV` are
undistorted on load. Fisheye models exit 2.

Output: `scene.ply` (standard 3DGS PLY, Y-down), `scene.spz` (official Niantic library),
`train.json` (iterations, Gaussian count, holdout PSNR and SSIM, file sizes, timings), and with
`--preview-video` `preview.mp4` (1920x1080, 30 fps, at most 20 s, H.264 yuv420p, faststart) and
`poster.jpg`.

Progress is JSON lines on stdout (`{"stage","progress"}`). Exit codes: 0 ok, 1 GPU or internal error,
2 unsupported input, 3 corrupt input, 4 quality gate (holdout PSNR below 18). On failure the last
stderr line is `{"error","message"}`.

## Presets

| preset | iterations | Gaussian cap |
|---|---|---|
| preview | 7000 | 3,000,000 |
| standard (default) | 30000 | 3,000,000 |
| high | 30000 | 6,000,000 |

Explicit `--iterations` and `--max-gaussians` override the preset.

## Method

gsplat 1.5.3 (Apache-2.0) `rasterization` in anti-aliased mode with `MCMCStrategy` (cap on the
Gaussian count, refinement schedule scaled by iterations/30000), opacity and scale regularisation,
an anisotropy limit, and pruning of Gaussians farther than 3 robust scene radii from the cameras.
The appearance embedding is off by default (`--appearance-embedding` turns it on). One image per
block of `--holdout-every` is held out with a rotating offset so every rig view is evaluated;
the split is a pure function of the image count. Poses are gravity-aligned and normalised before
training, so the learned spherical harmonics are already in the exported frame (3DGS Y-down;
the `/splat` viewer rotates it upright).

SPZ is written with the official library, converting RDF to the SPZ RUB convention.

## Dependencies

`requirements.d/splat_train.txt` lists them with the install order. GPU training needs CUDA; the
CLI contract, PLY, SPZ and video paths are tested without a GPU (`pytest tests/test_splat_train.py`).
Set `SPLAT_TRAIN_TEST_DATASET` to a COLMAP dataset to include the GPU end-to-end test.

## Measured on an L4 (Cloud Run Job, europe-west1)

Image: CUDA 12.4, torch 2.4.1, gsplat 1.5.3 prebuilt wheel (`pt24cu124`), spz built from source.
Training images are downscaled to 1600 px on the long side, 30 holdout images (one per 8).

| dataset | iterations | Gaussians | holdout PSNR | holdout SSIM | scene.ply | scene.spz | wall time | peak GPU |
|---|---|---|---|---|---|---|---|---|
| Mip-NeRF 360 `counter` (240 images) | 7000 | 2,996,756 | 28.21 dB (28.53 unpruned) | 0.9166 | 743 MB | 56 MB | 1710 s (1643 s training) | 4.26 GB |

`preview.mp4` for that run: 1920x1080, 30 fps, 600 frames, 20.0 s, h264 yuv420p, 29 MB. The PLY and SPZ
both open in `/splat` without console errors. Orders 335 and 347 add the 30000 iteration rows and a
second dataset as they are measured.

Do not install gsplat from source on the job image: the JIT build of its CUDA extension took
441 s on first import. Use the prebuilt wheel from `https://docs.gsplat.studio/whl/pt24cu124`.

## Licenses

gsplat is Apache-2.0, the SPZ library is MIT. The Inria 3DGS code and its forks are not used (non
commercial). Mip-NeRF 360 does not state a data license, so it is used only to measure and its
images and outputs are never shipped. Datasets that ship in product demos must carry an explicit
commercial-compatible license (CC0 or CC BY) recorded in the fixtures manifest.
