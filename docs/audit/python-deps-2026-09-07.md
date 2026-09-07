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
