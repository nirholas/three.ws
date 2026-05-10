# Task: GLB Asset Compression Pipeline

## Project overview

This is a Three.js / Vite app at `/workspaces/3D-Agent`. It renders 3D avatars and animations for an AI agent marketplace. The frontend stack is vanilla JS modules + Vite (`npm run dev` on port 3000). Backend is Vercel functions in `api/`. All 3D work uses Three.js (latest) with GLB/GLTF assets.

## Problem

The avatar GLB files served to browsers are **uncompressed**. Sizes today:

- `public/avatars/default.glb` — 2.8 MB
- `public/avatars/cz.glb` — 2.1 MB
- `public/animations/soldier.glb` — 2.1 MB
- `public/animations/robotexpressive.glb` — 454 KB
- `rider/assets/avatars/cz.glb` — copy of above
- `rider/assets/avatars/soldier.glb` — copy of above
- `rider/assets/avatars/default.glb` — copy of above
- `rider/assets/avatars/robotexpressive.glb` — copy of above

EXT_meshopt_compression typically achieves **10–15× compression** on avatar geometry. Draco achieves 40–60%. The project already has `@gltf-transform/core` and `@gltf-transform/extensions` in `package.json` (versions ^4.3.0). The `@gltf-transform/functions` package is not yet installed. Neither is the CLI.

The main viewer (`src/viewer.js`) already has Draco + KTX2 + MeshoptDecoder wired via `getDecoders()` in `src/viewer/internal.js` — so compressed GLBs will decompress automatically when loaded there. The marketplace lobby (`src/marketplace-lobby.js`) uses a bare `GLTFLoader` with no decoders (that is fixed in a separate task); the compression script must therefore produce **meshopt-compressed** output (not Draco-only), because meshopt is the decoder already imported in the main viewer and the lobby task will add it too.

## What to implement

### 1. Install required packages

```bash
npm install --save-dev @gltf-transform/functions @gltf-transform/cli meshoptimizer
```

`meshoptimizer` is the native WASM backing for gltf-transform's meshopt encoder.

### 2. Create `scripts/compress-glbs.mjs`

Write a Node ESM script that:

1. Accepts an optional list of GLB paths as CLI args. If none provided, defaults to compressing every `.glb` file under `public/` and `rider/assets/` (recursive, excluding `dist/`).
2. For each GLB:
   a. Reads the file with `@gltf-transform/core` `NodeIO`.
   b. Applies the following transforms **in order** using `@gltf-transform/functions`:
      - `dedup()` — deduplicate accessors and textures
      - `prune()` — remove unused nodes, skins, textures
      - `resample()` — resample animation curves to remove redundant keyframes
      - `quantize()` — quantize vertex attributes (position, normal, texcoord) to reduce precision to what's perceptually lossless
      - `meshopt({ encoder: MeshoptEncoder })` — apply EXT_meshopt_compression
      - `textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85 })` if `sharp` is available; otherwise skip texture compression with a console.warn (do not throw)
   c. Writes the result back to the **same path**, overwriting the original.
   d. Logs: original size, compressed size, % reduction, and whether the file grew (which would indicate something went wrong — warn and skip writing in that case).
3. At the end, prints a summary table of all files processed.

Use `MeshoptEncoder` from `meshoptimizer/meshopt_encoder.js` (the ESM export). The encoder must be initialized with `await MeshoptEncoder.ready` before use.

**Do not use `sharp`** — skip the `textureCompress` step entirely for now (it requires a native binary and adds CI complexity). Leave a `// TODO: add textureCompress once sharp is added to devDependencies` comment.

### 3. Add an npm script in `package.json`

Add to the `"scripts"` block:

```json
"compress:glbs": "node scripts/compress-glbs.mjs"
```

### 4. Run the compression

Run `npm run compress:glbs` and let it process all GLBs in `public/` and `rider/assets/`. Print the before/after sizes for each file. If any file grows in size, skip writing it and log a warning.

### 5. Update `.gitignore` if needed

The compressed GLBs replace the originals in-place, so no `.gitignore` change is needed. But add a comment near the GLB section of `.gitignore` (if one exists) noting that GLBs are committed in compressed form.

### 6. Verify the main viewer still loads avatars correctly

- Run `npm run dev`
- Open `http://localhost:3000` in a browser
- Confirm the default avatar loads and animates without console errors
- Confirm the network tab shows the compressed GLB sizes (should be significantly smaller)
- Check that morph targets (facial expressions) still work — the Empathy Layer in `src/agent-avatar.js` drives them

## Constraints

- Do not modify any `.js` source files in `src/` — this is purely an asset pipeline task.
- Do not remove the original FBX files in `public/animations/` — they are source files used by the build pipeline, not served to browsers.
- The animation clips in `public/animations/clips/*.json` are pre-retargeted JSON data, not GLBs — do not touch them.
- The script must be idempotent: running it twice on already-compressed files should result in files of similar or smaller size, not growth.
- Use `NodeIO` from `@gltf-transform/core` for all file I/O — do not use raw `fs.readFileSync` on GLBs.
- The script must be pure ESM (`.mjs` extension, `import` statements, no `require`).

## Definition of done

- `npm run compress:glbs` runs without errors.
- `public/avatars/default.glb` and `public/avatars/cz.glb` are measurably smaller (at minimum 20% smaller; expect 50–80%).
- `npm run dev` starts successfully.
- The avatar renders in the browser with no console errors.
- The morph-target empathy layer (eye squint, mouth smile, brow raise) still visually responds to agent events.
- `git diff --stat` shows only the compressed GLB binaries changed plus `package.json`, `package-lock.json`, and the new script file.
