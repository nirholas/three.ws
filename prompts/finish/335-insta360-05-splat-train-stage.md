# insta360 05: `splat_train`, the stage that trains a Gaussian splat from a COLMAP dataset and renders its preview

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `insta360-` order, so it can run in parallel with all of them. No dev server (port 3335 only if you open `/splat` to inspect output).

## Operating clause (binding)

- Read CLAUDE.md, then [_context/insta360-00-CONTEXT.md](_context/insta360-00-CONTEXT.md) (contract C1: you own `splat_train/`, its CLI, outputs and exit codes). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Never contact a third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

This stage produces the file the user keeps: a standard 3DGS PLY and a compact SPZ, plus the flythrough MP4 that sells it in a share or drops onto a Premiere timeline. It must train from any standard COLMAP dataset, so you can build and measure it today on public datasets without waiting for the 360 stages. gsplat is Apache-2.0; the Inria reference code and its forks are non-commercial and banned (context file).

## Step 0: re-derive the current state

    ls workers/model-pano2splat 2>&1 && find workers/model-pano2splat -maxdepth 2 | head -40
    grep -rn "spz\|\.ply" src/splat-viewer.js src/splat-stage.js | head -20
    grep -rn "spz" package.json workers/*/requirements*.txt 2>/dev/null | head
    nvidia-smi 2>&1 | head -5

Read the gsplat repository's current release notes and `examples/simple_trainer.py`, and the `spz` library (Niantic, MIT) README; record the versions you pin.

## Tasks

1. **Package** `workers/model-pano2splat/splat_train/` plus `requirements.d/splat_train.txt` and `tests/test_splat_train.py`; touch nothing else in the worker. CLI exactly as contract C1, JSON-lines progress, exit codes with the stderr JSON line.
2. **Training** on gsplat: read the COLMAP dataset (cameras, images, optional masks; masked pixels excluded from the loss), initialise from `points3D`, train with the MCMC densification strategy and a Gaussian cap (`--max-gaussians`), anti-aliasing on, appearance embedding off by default (record whether enabling it helps on the 360 data later in 347), scale-regularization against needle artifacts, and sky handling: Gaussians outside a robust scene radius are pruned at the end. Every `--holdout-every` image is held out for PSNR and SSIM.
3. **Export**: `scene.ply` in the standard 3DGS attribute layout (positions, normals, `f_dc_*`, `f_rest_*`, opacity, scales, rotations) with +Y up to match the viewer; `scene.spz` via the official `spz` library; verify both load in `/splat` locally on port 3335 (the viewer must open them without changes; if it needs a change to read SPZ, that is a finding to report, not a fork to build here). Write `train.json` per contract with real byte sizes.
4. **Preview video**: `--preview-video` renders a flythrough with gsplat's rasterizer along the capture path (camera centres from COLMAP, spline-smoothed, look-ahead orientation, ease in and out), 1920x1080 at 30 fps, at most 20 s, encoded H.264 with ffmpeg (`yuv420p`, `+faststart`) so it plays everywhere and imports into Premiere; `poster.jpg` from the best frame by holdout PSNR. This is the platform's server-side splat video render: no other order builds one.
5. **Quality bar**: holdout PSNR below 18 exits 4 with a visitor-readable message about capture technique.
6. **Measure**: train on at least two public COLMAP datasets with commercial-use-compatible licenses (for example Mip-NeRF 360 scenes are CC BY 4.0: check on the day) and record PSNR, SSIM, Gaussian count, file sizes and wall time on an L4 at `--iterations 7000` and `30000`. Run through a Cloud Run Job (context file) with a throwaway image built from a CUDA base plus your requirements; 337 owns the production image. If order 334's progress entry lists a real 360 COLMAP output in GCS, also train on it and record the numbers.
7. **Tests**: CLI contract and exit codes, PLY header and attribute order, SPZ round trip (write, read back, positions within tolerance), preview video is 1920x1080 30 fps H.264 and at most 20 s (ffprobe), holdout split determinism. README in the package with flags, presets mapping (contract C1 quality presets), measured table and licenses.

## Definition of done

- [ ] `python -m splat_train` matches contract C1.
- [ ] Measured runs on 2 or more real datasets on a GPU, numbers in the README and the progress log.
- [ ] Output PLY and SPZ open in `/splat` locally; the preview MP4 plays in a browser and passes the ffprobe checks.
- [ ] Tests pass; dependencies pinned; `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| gsplat wheels do not match the CUDA base | Build gsplat from source in the job image with the matching `TORCH_CUDA_ARCH_LIST` (L4 is sm_89). |
| `/splat` cannot read a valid SPZ | Report it with the file; 347 or a follow-up fixes the viewer. Your PLY still proves the lane. |
| Dataset license unclear | Choose another public dataset with an explicit license; record it. |
| L4 quota | Context file region list or A100. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. Append to [_context/insta360-PROGRESS.md](_context/insta360-PROGRESS.md) with PSNR, size and time.
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the measured numbers; one-line judgment calls. No trailing questions.
