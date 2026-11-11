# Forge on-device photo check

Runs in the visitor's browser before a photo-to-3D upload: background matting
with ONNX Runtime Web, a square crop around the subject, and plain-language
quality warnings. Nothing leaves the device until the visitor confirms the
review dialog. Measurements, privacy notes and the verification run live in
[docs/forge-photo-prep.md](../../docs/forge-photo-prep.md).

| File | Role |
|---|---|
| `core.js` | Pure math, no DOM: input tensor, mask analysis, crop plan, sharpness and exposure metrics, the warnings and every threshold (`THRESHOLDS`), and the device gate. Unit tested in `tests/forge-photo-prep.test.js`. |
| `worker.js` | Web Worker: loads `onnxruntime-web` (WebGPU execution provider, WebAssembly fallback), fetches and caches the model, runs inference, encodes the prepared JPEG and the cutout WebP, reports real progress stages (`runtime`, `model`, `inference`, `encode`). |
| `client.js` | Main thread: capability detection (`photoPrepSupport`), one lazily created worker, `preparePhoto(file)`, and `DEFAULT_UPLOAD`. |
| `review.js`, `review.css` | The review dialog (original next to prepared, warnings, "Use anyway" or "Retake", "Send the original photo instead") and the slot's preparing overlay. Called from `uploadToSlot` in `src/forge.js`, loaded only after a photo is picked. |

## Model

| | |
|---|---|
| Model | U²-Netp (the 4.7 MB "portable" U²-Net) |
| File | `public/models/photo-prep/u2netp.309c8469.onnx` (the name carries the first 8 hex digits of the hash, so it is cached as immutable) |
| Size | 4,574,861 bytes |
| SHA-256 | `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8` |
| Source | `u2netp.onnx` from the rembg model release v0.0.0, an ONNX export of the weights published with U²-Net by Qin et al. (Pattern Recognition 2020) |
| License | Apache-2.0 (U²-Net repository and the rembg export) |
| Input | 1 x 3 x 320 x 320 float32, scaled by the image maximum then ImageNet mean and std |
| Output | First head, 320 x 320 saliency map, min-max normalised to the mask |

Why this model: it is the only permissively licensed salient-object matting
model small enough to download on a phone without asking. Alternatives that
were evaluated and rejected: ISNet general (AGPL), RMBG 1.4 and 2.0
(non-commercial license), MODNet (portraits only) and BiRefNet lite (115 MB,
too heavy for a phone download before every first upload). The server keeps its own BiRefNet matting, so the
on-device mask decides the crop and the warnings; it does not have to be
pixel perfect.

To verify the file: `sha256sum public/models/photo-prep/u2netp.*.onnx`.

## Runtime

`onnxruntime-web` comes from `package.json`. Its wasm binaries are served from
`/models/voice/runtime/`, staged by `scripts/copy-voice-models.mjs` (shared with
the voice loop; it also stages the asyncify build the WebGPU provider needs).
The model is fetched once and kept in the Cache API (`three-ws-photo-prep-v1`).

## Fallback

The check is skipped, and the original uploads exactly as before with a
one-line note, when the browser lacks Web Workers, `OffscreenCanvas` or
`createImageBitmap`, when it reports under 1 GB of device memory, when the
photo is over 40 MB, or when the model fails to load or run.

## Checks

```bash
npx vitest run tests/forge-photo-prep.test.js
node scripts/forge-photo-prep-verify.mjs --base=http://localhost:3109   # real browser, network log
node scripts/forge-photo-prep-bench.mjs --skip-generate                 # metrics on the bench photos
```
