# Task: Browser-side photo-to-avatar (MediaPipe fast path)

## Context

Repo: `/workspaces/3D`. Tasks 04/06 deliver `{ left, center, right }` photo blobs. This task converts that triple into a **first-pass avatar** entirely client-side, in seconds, using Google's MediaPipe Face Landmarker (Apache-2.0) to detect 478 3D landmarks + 52 blendshapes.

The output is recognizable, not photoreal. It's the "instant gratification" result that shows the user something immediately while the HD path (task 08) runs in the background.

Depends on tasks 02 and 04 (or 06).

## Goal

1. Given `{ center: Blob }` (left/right are ignored in v1 — they'll feed task 08), produce a VRM file (or a patched VRM from a base template) that resembles the user.
2. The template is a neutral base VRM bundled in [public/avatars/](../../public/avatars/).
3. Customization applied:
   - Head shape morphed toward the detected face via landmark-driven morph targets or a blendshape approximation.
   - Face texture projected from the center photo.
   - Skin tone sampled from the face and applied to exposed skin slots.
   - Hair kept from the template (editor UI in task 16 lets the user swap).
4. Total time from blob in to avatar rendered < 5 seconds on a mid-range laptop.

## Deliverable

1. **Base template** — `public/avatars/template-neutral.vrm`. A rigged, expression-ready VRM with a neutral face. Source with CC0/MIT license only. Record in `public/avatars/NOTICES.md`.
2. **MediaPipe integration** `src/capture/face-landmarks.js`:
   - Loads MediaPipe Face Landmarker WASM + model from a CDN or vendored at `public/vendor/mediapipe/`.
   - Exports `detectFace(blob) -> { landmarks: Float32Array[478*3], blendshapes: Record<string, number>, matrix: Float32Array[16] }`.
   - Model is loaded lazily on first call, cached for subsequent calls.
3. **Avatar generator** `src/capture/fast-avatar.js`:
   - `async generate({ center, left?, right? }) -> Blob` — a VRM Blob.
   - Loads the template VRM, applies morphs/textures, exports with `VRMExporter` (from `@pixiv/three-vrm-core` or implement via `GLTFExporter` + manual VRM extension patching).
4. **Head-shape approximation** — use a small set of morph-target drivers:
   - Face width → `faceWidth` morph (if template has it) or a scale on jaw bones.
   - Face length → scale Y on cranium bone.
   - Nose prominence → nose morph or localized mesh displacement.
   - Document exactly which drivers the template exposes in `public/avatars/template-neutral.vrm.meta.json`.
5. **Texture projection** — crop the center photo to the face region detected by MediaPipe, warp to the template's UV head region using the 478-landmark topology. Use a small offscreen canvas + perspective warp. This is the biggest quality lever; budget it explicitly.
6. **Skin-tone sampling** — average pixels inside the face mesh polygon (excluding eyes/mouth), convert to linear sRGB, find nearest slot and apply to all skin-mapped materials.
7. **Fallback** — if MediaPipe fails to detect a face, resolve with the plain template and emit a `photo_quality_low` warning; the caller can surface a "retake" option.

## Audit checklist

- [ ] `generate({ center })` on a test photo completes in < 5s on a dev machine (document the machine).
- [ ] Output is a valid VRM that loads in the viewer (task 02 path).
- [ ] Skin tone of the output visibly matches the input photo within a reasonable delta (no pink Caucasian default for a darker-skinned input).
- [ ] Three very different faces produce three visibly different avatars.
- [ ] A photo with no face rejects or returns a flagged template — doesn't silently produce garbage.
- [ ] MediaPipe model is loaded once per page session, not per call.
- [ ] No PII persisted: after `generate` resolves, no image bytes remain in module state.
- [ ] `node --check` the new JS.
- [ ] Bundle impact: MediaPipe loader code ≤ 20 KB; the WASM + model are lazy-loaded and cached by the browser / service worker.

## Constraints

- Client-only. No network calls beyond the MediaPipe model fetch (CDN or self-hosted).
- No ML model training or fine-tuning in-browser. MediaPipe's stock model only.
- Do not attempt photoreal texture stitching from all three photos — that's task 08's job (server-side, NextFace).
- The template VRM must be CC0/MIT; flag and stop if nothing fits.
- Use `@pixiv/three-vrm` for load/save; don't reinvent the VRM parsing.

## Verification

1. `node --check` new files.
2. Run the full flow: task 04's `PhotoCapture.open()` → pass blobs to `generate()` → add resulting scene to viewer.
3. Five test images (diverse lighting, skin tones, angles, one with glasses, one low-quality) → each produces a sensible avatar or a clear reject.
4. Time the pipeline with `performance.now()` — include mean, p95, max.
5. Close and reopen the tab; re-run → MediaPipe loads from cache on second run.

## Scope boundaries — do NOT do these

- No HD face reconstruction — that's task 08.
- No voice/speech wiring.
- No saving to a backend — the returned VRM Blob is handed to the caller.
- No editor UI — the user can only see the avatar after generation; customization comes in task 16.
- Do not attempt to generate hair from the photo. Too fragile; keep template hair.

## Reporting

- MediaPipe Face Landmarker version used and model URL.
- Template VRM source + license + a note on which morph targets it exposes.
- Median/p95/max generation time + dev machine specs.
- A short qualitative assessment: "for these N test faces, this path is {recognizable / uncanny / unusable}".
- Known failure modes (e.g., side-lit photos, non-frontal angles, heavy makeup) and which ones warrant a retake prompt in task 20's onboarding.
- Flag any texture-projection artifacts that suggest we need a different warping approach.
