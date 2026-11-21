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
