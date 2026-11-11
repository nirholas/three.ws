# microsoft 09: on-device photo preparation for photo-to-3D with ONNX Runtime Web

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3109.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

Photo-to-3D quality is decided before the GPU starts: a busy background, a tiny subject or a blurry shot produces a bad mesh and wastes a TRELLIS.2 run. ONNX Runtime Web already runs speech models on the visitor's device in three.ws. Running background removal and a photo quality check the same way shows the user exactly what the model will see, catches bad photos before they cost anything, uploads a smaller file, and extends the "Microsoft tech running in three.ws" story from voice into Forge.

## Step 0: re-derive the current state

    grep -rn "onnxruntime-web" package.json src | head
    sed -n 1,80p src/runtime/whisper-stt.js
    grep -rln -i "photo\|image-to-3d\|img2" src/forge*.js | head
    grep -rn -i "rembg\|background\|birefnet\|matting\|alpha" workers/model-trellis2 | head -20

Find the Forge photo input flow and whether the TRELLIS.2 worker already removes the background server-side (if so, the on-device pass previews and pre-crops; it must not double-process in a way that hurts quality: test both). Choose a segmentation model whose license allows commercial use (verify from its LICENSE or model card; for example BiRefNet MIT or MODNet Apache-2.0; exclude non-commercial models).

## Tasks

1. **Model asset.** Export or obtain the chosen model in ONNX (quantized if quality holds), host it from our own storage or `public/` with long-cache headers, record its source, license and checksum in a README next to the loader.
2. **On-device pipeline** in a Web Worker: ONNX Runtime Web with the WebGPU execution provider and WASM fallback; background removal to an alpha mask; subject bounding box, auto-crop with padding and square pad; quality checks with clear thresholds (subject too small, blur via Laplacian variance, too dark or overexposed, multiple disconnected subjects).
3. **UI in the photo flow.** Before upload: the original and the prepared image side by side, the warnings in plain words with "use anyway" or "retake", a toggle to send the original. Progress is real (model load and inference events). If the device cannot run it, the flow continues exactly as today with a one-line note.
4. **Measurement.** Run 8 to 10 real photos (varied subjects, some deliberately bad) through the production TRELLIS.2 lane with and without the on-device preparation (GCP spend is pre-approved). Record upload size, end-to-end time and a side-by-side render of each result in `docs/forge-photo-prep.md`. Ship the default the data supports.
5. **Docs.** `docs/forge-photo-prep.md` (what runs on-device, privacy, the measurement table), link from docs/microsoft.md's ONNX Runtime row, changelog entry.

## Definition of done

- [ ] Test-first unit tests for crop and pad math, quality thresholds, and the fallback decision.
- [ ] A Playwright run on port 3109 prepares a real photo in the browser with no image request leaving before the user confirms (network log in the report).
- [ ] The measurement table with real production runs exists and the chosen default matches it.
- [ ] No console errors; loading, warning and fallback states verified; `npm test` passes; docs and changelog landed.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| WebGPU unavailable in headless Chromium | Test with the WASM execution provider in CI-style runs; verify WebGPU with a headed run if the machine allows, otherwise note it. |
| Model too large for a good first load | Quantize, lazy-load only when the user picks a photo, and cache with the Cache API. |
| Server already removes backgrounds | Keep the on-device pass for preview, crop and quality gating; send the original pixels when the measurement shows server matting is better. |
| Licence unclear for a candidate model | Drop it and use the next permissively licensed one. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git rm` this file in the closing commit. An owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
