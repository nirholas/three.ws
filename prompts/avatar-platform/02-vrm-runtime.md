# Task: Adopt VRM as the avatar format and wire @pixiv/three-vrm into the viewer

## Context

Repo: `/workspaces/3D`. The viewer in [src/viewer.js](../../src/viewer.js) uses three.js with `GLTFLoader` and accepts `.gltf` / `.glb`. Downstream tasks need **VRM** (a glTF extension with standardized humanoid bones, expressions, and spring-bone physics) so that TalkingHead (09), Kalidokit mirror mode (12), and CharacterStudio (03) all compose cleanly.

VRM files are valid GLB. The viewer already loads them geometrically. What's missing is the VRM-specific runtime: expressions (`aa`, `ih`, `blink`, `happy`...), humanoid bone API, and optional MToon shader. `@pixiv/three-vrm` is the MIT-licensed standard from VRoid.

## Goal

After this task:

1. `@pixiv/three-vrm` is installed and the viewer loads `.vrm` files (and any `.glb` that happens to carry the VRM extension) with the VRM runtime attached.
2. `window.VIEWER.activeVRM` exposes the loaded `VRM` instance (or `null`), for downstream modules to introspect.
3. A simple smoke test — loading a known VRM and firing a single expression (`aa`) through the console — works.
4. Loading a plain non-VRM GLB still works exactly as before.

## Deliverable

1. **Install** — `npm install @pixiv/three-vrm`. Pin to the latest 3.x (check the upstream for the current major). Update lockfile.
2. **New file** `src/vrm-runtime.js`:
   - Exports `createVRMLoaderPlugin(gltfLoader)` that registers the VRM plugin on the provided `GLTFLoader`.
   - Exports `async loadVRM(gltfLoader, url)` returning `{ scene, vrm }` where `vrm` is the `VRM` instance or `null` if the file is plain GLB.
   - Exports `updateVRM(vrm, deltaSeconds)` calling `vrm.update(dt)` — used by the render loop.
   - Exports `disposeVRM(vrm)` — cleans up spring bones and detaches.
3. **Modify [src/viewer.js](../../src/viewer.js)** — in the GLTFLoader setup, install the VRM plugin. In the scene-setup path that runs after a model loads, detect `gltf.userData.vrm` (set by the plugin). If present:
   - Store it as `this.activeVRM`.
   - In the render/update loop, call `updateVRM(this.activeVRM, delta)` every frame.
   - On model replacement/dispose, call `disposeVRM(previous)`.
4. **Expose** — `window.VIEWER.activeVRM` reads from `app.viewer.activeVRM`.
5. **Accept `.vrm` in the file picker / dropzone** — search [src/app.js](../../src/app.js) and the dropzone config for the `.glb, .gltf` accept list; add `.vrm`.
6. **Smoke-test asset** — download a public CC0 VRM (e.g., one of the AvatarSample set from VRoid Hub, or a file from the asset-library task later) into [public/avatars/](../../public/avatars/) as `sample.vrm`. License info goes into a `public/avatars/NOTICES.md` (create it).

## Audit checklist

- [ ] `npm ls @pixiv/three-vrm` prints a single resolved version, no duplicates.
- [ ] Dropping `sample.vrm` onto the viewer loads the character; dropping a known-good GLB still works.
- [ ] In DevTools console: `VIEWER.app.viewer.activeVRM.expressionManager.setValue('aa', 1); VIEWER.app.viewer.activeVRM.update(0)` — the mouth opens.
- [ ] Loading a non-VRM GLB → `VIEWER.app.viewer.activeVRM === null`.
- [ ] The render loop calls `updateVRM` exactly once per frame when a VRM is loaded (profile in Performance tab).
- [ ] Spring bones (hair / skirt) settle and move under gravity when you orbit the camera quickly.
- [ ] Disposing and reloading does not leak — no duplicate spring-bone listeners after three reloads (check via a heap snapshot or manual counter).

## Constraints

- **No changes to the non-VRM GLB code path.** Plain GLBs render the same as before.
- Use `@pixiv/three-vrm` via npm, not vendored — this one is infrastructural, and the README.md carves out the exception.
- Do not import anything from `@pixiv/three-vrm-springbone`, `-animation`, etc. separately — the umbrella package re-exports what's needed.
- Do not add React, r3f, or any framework. Stay in vanilla JS + three.js.
- Do not commit a VRM file larger than 10 MB. If `sample.vrm` is bigger, use [git-lfs](https://git-lfs.com/) via the existing `.gitattributes` — or pick a smaller sample.

## Verification

1. `node --check src/vrm-runtime.js`.
2. `npx vite build` passes; bundle size delta is reported in the summary.
3. Dev server, load `sample.vrm` → character renders with correct material (MToon or standard).
4. Console smoke test from audit checklist passes.
5. Load plain `.glb` → renders, `activeVRM === null`, no errors.
6. Reload-and-dispose loop (3×) → no leaked listeners.

## Scope boundaries — do NOT do these

- Do not build the editor UI or expression panel. That's task 16.
- Do not add lipsync, TTS, or any audio wiring. Tasks 09–10.
- Do not add automatic `lookAt` / gaze tracking — that's either the existing pretext task 03 (for `model-viewer` only) or deferred.
- Do not swap three.js versions.

## Reporting

- Version of `@pixiv/three-vrm` installed and its peer-dep compatibility with `three@^0.176`.
- Bundle size before vs after.
- Any console warnings from the VRM plugin on the sample file.
- The sample VRM's source URL and license, copied into `public/avatars/NOTICES.md`.
- Render-loop deltaTime measurement (mean + p95) with a VRM loaded, before any animation features land.