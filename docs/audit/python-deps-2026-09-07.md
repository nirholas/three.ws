# Python worker dependencies: first OSV scan, 2026-09-07

The first vulnerability scan of the Python half of the platform. `npm audit`
covers the JavaScript tree; nothing covered the 20 requirements files that pin
the runtime of every GPU and CPU worker, so nothing ever had.

Reproduce with `npm run audit:deps` ([scripts/check-deps.mjs](../../scripts/check-deps.mjs)).
It queries [OSV](https://osv.dev) for every exact-pinned requirement under
`workers/`, `services/` and `packages/`.

**First run: 321 advisories across 19 pinned package versions, out of 100
pinned packages in 20 files.** After the fixes below: 285 across 17.

## Fixed in this pass

Both were chosen the same way: severity, times whether a caller's bytes reach
the vulnerable code.

### Pillow 11.0.0 to 12.3.0 (rembg, remesh, texture)

34 advisories, 13 of them HIGH: heap out-of-bounds writes in `Image.paste()` and
`Image.crop()` via signed coordinate overflow, an out-of-bounds write in the PSD
loader, a controlled heap write in `ImageCmsTransform.apply()`, an out-of-bounds
read on the mmap path, and a family of decompression-bomb bypasses in the font
and PDF loaders.

All three workers decode an image the caller supplied. This was the most directly
reachable finding in the scan.

Verified before bumping:

- The rembg worker's full smoke test (20 checks, both baked-in models) passes on
  Pillow 12.3.0, and so does the BiRefNet path added earlier today.
- `pip check` is clean on the rembg requirement set.
- No package pinned in remesh or texture caps Pillow below 12; `transformers`
  is the only one that constrains it at all, at `>=10.0.1,<=15.0`.
- Every PIL symbol those two workers use (`Image.LANCZOS`, `Image.NEAREST`,
  `fromarray`, `new`, `composite`, `open`, `resize`, `convert`) exists in 12.3.0
  and the exact call chain round-trips.

remesh and texture were bumped on that evidence rather than a functional run:
their images need a build to exercise, which happens on their next deploy.

### usd-core 24.11 to 25.11 (remesh)

`GHSA-58p5-r2f6-g2cj`, CRITICAL: a `Sdf_PathNode` use-after-free leading to
potential remote code execution, plus a MODERATE file-parsing use-after-free of
the same class.

Exposure here was narrower than the severity suggests: remesh only *authors* USD
(`Usd.Stage.CreateNew`), it never parses a caller's USD file. A pinned CRITICAL
is still not a thing to keep. Verified that 25.11 imports the same module set the
worker uses (`Gf, Sdf, Usd, UsdGeom, UsdShade, UsdUtils, Vt`) and that
`UsdUtils.CreateNewUsdzPackage` still produces a valid USDZ.

## What is left, in priority order

### 1. `libassimp5`, not `pyassimp` (remesh, stylize)

33 advisories against `pyassimp==5.2.5`, and **bumping the pin cannot fix any of
them**: 5.2.5 is the last release on PyPI, and the vulnerable code is the assimp
C++ library, which both Dockerfiles install from Debian as `libassimp-dev
libassimp5`. The scanner points at the Python binding because that is what a
requirements file can name.

This matters because assimp is the trimesh backend for **FBX and DAE input**, so
a caller's mesh file goes through it. The lever is the base image: rebuild both
workers on a Debian release carrying a patched `libassimp5`, or drop the FBX/DAE
input path to Blender, which remesh already ships for FBX export.

### 2. `transformers` 4.41.0 / 4.46.0 / 4.46.3 / 4.47.1 (longcat, hunyuan3d, triposg, texture)

43 advisories each, 6 HIGH, fixed in 5.0.0. Two different classes hide in that
number and they need separating before anyone bumps a major version across four
GPU workers:

- **Unsafe deserialization when loading a model or config.** Not caller
  reachable: every worker loads pinned weights we staged ourselves.
- **ReDoS in tokenizer and config regexes.** Potentially caller reachable, because
  a user's text prompt does reach a tokenizer on the generation lanes.

Read the second class first; it decides whether this is urgent or housekeeping.

### 3. `torch` 2.3.1 (texture)

23 advisories, one CRITICAL: `torch.load` with `weights_only=True` leading to
remote code execution. Same reachability answer as transformers, the worker loads
its own weights. The fix is 2.7.1, which is a CUDA-compatibility decision for the
whole image rather than a pin edit, so it belongs with the next texture worker
rebuild.

### 4. The cheap ones

| Package | Pinned | Fixed in | Worker |
|---|---|---|---|
| `requests` | 2.32.3 | 2.33.0 | avatar-reconstruction |
| `pynacl` | 1.5.0 | 1.6.2 | stylize |
| `rembg` | 2.0.56 / 2.0.59 / 2.0.65 | 2.0.75 | avatar-reconstruction, model-triposr, model-hunyuan3d, rembg |
| `diffusers` | 0.30.0 / 0.31.0 / 0.35.1 | 0.38.0 | model-hunyuan3d, model-triposg, texture, longcat |
| `onnx` | 1.18.0 | 1.22.0 | longcat |
| `pytorch-lightning` | 1.9.5 | 2.4.0 | model-hunyuan3d (2.1 image) |
| `basicsr` | 1.4.2 | no fix published | model-hunyuan3d (2.1 image) |

`requests` and `pynacl` are one-line bumps with no model-behaviour risk and
should go with the next deploy of those workers. `rembg` changes the inference
path this platform's cutouts run on, so it wants the same treatment BiRefNet got:
run the worker's smoke test against the new version first.
`pytorch-lightning` 1.9.5 to 2.4.0 is a major version inside a GPU image whose
Python stack is already pinned around torch 2.5, and `basicsr` has no fixed
release at all, so both are constrained by the Hunyuan 2.1 image rather than by
the pin.

## Notes on the scan itself

- **`npm run audit:deps` needs network and is deliberately not in the gate.** A
  build must not fail because api.osv.dev is having a bad afternoon. It is
  registered as an on-demand guard in [data/guards.json](../../data/guards.json).
- **It only sees exact pins.** `pkg>=1.2`, `pkg~=1.2` and a bare `pkg` resolve to
  whatever the build found that day, which is a reproducibility problem before it
  is a security one. `node scripts/check-deps.mjs --unpinned` lists them.
- **A locally built wheel is queried on its public version.** The CUDA wheels
  (`torch-cluster==1.6.3+pt21cu121`) are our rebuild of an upstream release, and
  OSV indexes the release.
- **The parser is tested** ([tests/check-deps.test.js](../../tests/check-deps.test.js)),
  including an assertion that every requirement line in the tree is classified.
  A parser that silently drops a line reports a package clean without ever
  looking at it, which is worse than not scanning.

## Status 2026-11-03

Work order 725 re-ran the scan on 2026-11-03 (84 advisories across 9 package
versions) and closed what a pin edit can close. Measured on 2026-11-04 after the
changes below, `node scripts/check-deps.mjs` reports **225 advisories across 13
package versions**. The rise from 84 comes from visibility, not new exposure,
and the like-for-like number fell:

| Slice | Advisories |
|---|---|
| The 9 package versions the 2026-11-03 scan measured, after this pass | 40 (was 84) |
| `model-partcrafter` pins added by another workstream since (`accelerate==1.7.0`, `diffusers==0.33.1`, `transformers==4.52.4`) | 33 |
| Pillow, newly visible because every `Pillow>=` floor is now an exact pin | 152 (`12.3.0`: 59, `11.3.0`: 93) |

Before the pins, those Pillow floors had already resolved to the same versions
(resolver proof, Cloud Build `9dd3f39c`), so the 152 were shipping, unseen.

### What changed

- **LongCat `transformers` 4.41.0 to 4.57.6** (`workers/longcat`:
  `requirements-model.txt`, `constraints.txt`, and the `check_pins.py` build
  assertion). Clears 44 advisories, including every tokenizer ReDoS that a user
  prompt could reach. Proof: a CPU probe (Cloud Build `99062071`) ran upstream's
  own avatar-v1.5 text path (real tokenizer, real umT5 config at reduced depth,
  seeded) and audio path (real `whisper-large-v3` weights, upstream's sample
  speech) under both versions: token ids identical, text and audio embeddings
  bit-identical (`max_abs_diff 0.0`). A second build (`f27e37d8`) installed the
  worker's complete `requirements-model.txt` and `requirements.txt` under
  `constraints.txt` for each version: `pip check` clean on both, and all 14
  upstream `longcat_video` modules (DiT, attention, both pipelines) plus the
  avatar script's `audio_separator` import load on both. avatar-v1.0's Wav2Vec2
  wrapper breaks on 4.53+, which does not matter here because `main.py` always
  passes `--model_type avatar-v1.5`.
- **Every Pillow line is an exact pin** at the newest release the worker's
  runtime can install, enforced by `tests/worker-pillow-pins.test.js`:
  `13.0.0` (no open advisory) on Python 3.11+ (`garment-forge`); `12.3.0`, the
  last line for Python 3.10, on `avatar-reconstruction`, `model-hunyuan3d`,
  `model-triposg`, `model-triposplat`, `model-triposr`; `11.3.0` on
  `model-sam3d-objects`, held by upstream's `gradio==5.49.0` (`pillow<12`).
- **Caller images decode only as PNG, JPEG or WEBP.** `open_caller_image` in the
  vendored `worker_security.py` passes `formats=` to `Image.open`, so TIFF, GIF,
  BMP, PSD, MPO, DCX, MIC, FPX, SPIDER, XBM, EPS, WMF and every other plugin
  never parse caller bytes. That removes most of the 12.3.0 and 11.3.0 decoder
  advisories from reach. All six image-taking workers route through it, and an
  undecodable image is the caller's error (`422` or an `input` job failure), not
  a worker fault. `model-triposg` used to report it as an internal fault.
- **sam3d EXIF guard.** `model-sam3d-objects` is the only one of these workers
  that calls `ImageOps.exif_transpose`. It now skips an EXIF block over 64 KiB
  (the JPEG APP1 ceiling, so no real camera exceeds it), which removes
  PYSEC-2026-4342 / GHSA-g4qv-2jxx-769h (quadratic PNG eXIf parse) from reach on
  11.3.0.

### Accepted residue, with reasons

| Package version | Where | Reason it stays |
|---|---|---|
| `Pillow==12.3.0` (59) | 5 Python 3.10 workers | 13.0.0 requires Python 3.11; clearing it needs each image's base move. Reachable residue after the format allowlist: the JPEG decoder overflow (GHSA-8g5g-8vmr-9782) and APNG canvas allocation (GHSA-5xm2-6676-qcp9). PYSEC-2026-4332 needs `draft()` or `thumbnail()`, which none of these workers call. |
| `Pillow==11.3.0` (93) | `model-sam3d-objects` | Blocked by upstream `gradio==5.49.0` (`pillow<12`). Same JPEG/APNG residue; the eXIf one is guarded as above. |
| `transformers==4.57.6` (11) | hunyuan3d, triposg, texture, modly, longcat | Every remaining advisory is fixed only in 5.x or not at all, and none is caller-reachable: all concern loading a malicious model repo or config (`trust_remote_code` bypasses, LightGlue, custom generate code, `_attn_implementation_internal`), `Trainer` checkpoints, X-CLIP conversion, or `save_pretrained`. These workers load only weights we stage ourselves and never train or save. 5.x is a major API change inside GPU images whose upstream model code targets 4.x. |
| `diffusers` 0.30.0 / 0.31.0 / 0.35.1 (5 each) | hunyuan3d, triposg, texture, modly, longcat | All five are `trust_remote_code` / `custom_pipeline` bypasses in `DiffusionPipeline.from_pretrained` against an attacker's Hub repo. Not caller-reachable: pipelines load only staged weights, and the one `custom_pipeline` (`model-hunyuan3d/app21.py`) is the fixed, vendored `hy3dpaint/hunyuanpaintpbr` path. 0.38.0 is a cross-fleet upgrade to take with each image's next model refresh. |
| `rembg` 2.0.59 / 2.0.65 / 2.0.69 (4 each) | triposr, avatar-reconstruction, hunyuan3d, modly | Every advisory is in rembg's HTTP server or custom-model loading (path traversal via `model_path`, SSRF/CORS, SAM model injection). These workers call the library `remove()` with fixed bundled models and never run the server. The fixed releases (2.0.75+) need Python >= 3.11, numpy >= 2.3 and onnxruntime >= 1.23.2, which the 3.10 images cannot take. |
| `basicsr==1.4.2` (2) | hunyuan3d 2.1 image | No fixed release published. The command injection is in its SLURM distributed-init helper, which inference never calls. |
| `accelerate==1.7.0`, `diffusers==0.33.1`, `transformers==4.52.4` (33) | `model-partcrafter` | Owned by the PartCrafter workstream; out of this pass's scope. |

### Deploy note

The pins and code above take effect when each worker image is rebuilt through
the normal worker pipeline. Until then the deployed images run what they were
built with.
