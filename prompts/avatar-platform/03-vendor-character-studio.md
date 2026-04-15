# Task: Vendor CharacterStudio's CharacterManager into src/character/

## Context

Repo: `/workspaces/3D`. Task 02 established VRM as the avatar format via `@pixiv/three-vrm`. We now need an asset-driven customization runtime: hair, clothes, body, skin tone, morph presets. [M3-org/CharacterStudio](https://github.com/M3-org/CharacterStudio) is MIT-licensed, uses `@pixiv/three-vrm`, and recently refactored so that its core logic lives in a standalone `CharacterManager` class (no React dependency).

We are **vendoring** (copying source + attribution), not installing via npm — per this directory's [README.md](./README.md).

This task imports only the runtime. The UI (side-panel editor) is task 16.

## Goal

After this task:

1. `src/vendor/character-studio/` contains the upstream `CharacterManager` and its direct dependencies, trimmed to what we actually need (no React, no the CharacterStudio Next.js app shell).
2. A thin adapter `src/character/character-manager.js` exposes a stable API the rest of the app can depend on, hiding upstream changes.
3. A smoke test: instantiating `CharacterManager`, loading a manifest, attaching the resulting `scene` to our viewer — works.
4. Attribution is in `src/vendor/character-studio/NOTICE` (MIT text + upstream URL + commit SHA we vendored from).

## Deliverable

1. **Fetch upstream** — `git clone https://github.com/M3-org/CharacterStudio /tmp/character-studio` (shallow clone fine). Note the commit SHA; record it in `NOTICE`.
2. **Identify the core** — in upstream, locate `CharacterManager` and the modules it directly imports. Typically: character loading, asset swapping, VRM manipulation, export-to-GLB helpers. Do NOT pull in:
   - React components
   - Next.js routing
   - UI styling
   - Anything under `src/components/` that imports JSX
3. **Copy the minimal set** into `src/vendor/character-studio/`. Preserve the original relative import paths within that tree; adjust only the entry point.
4. **Adapter** `src/character/character-manager.js` — exports a class `CharacterManager` (our name, wraps the upstream one) with:
   - `async loadManifest(url)` — loads an asset manifest JSON.
   - `async loadTrait(traitGroup, traitId)` — e.g., `loadTrait('hair', 'hair-03')`.
   - `async removeTrait(traitGroup)`.
   - `getScene()` — returns a `THREE.Object3D` to add to the scene.
   - `async exportVRM()` / `async exportGLB()` — returns a `Blob`.
   - `dispose()`.
5. **Manifest bootstrap** — create `public/character-manifest.example.json` showing the schema. Task 17 replaces this with a real asset library.
6. **Viewer hook** — when a `CharacterManager` instance is created and `getScene()` is called, the consumer (future editor UI) decides when to add it. No automatic wiring in the viewer — keep the runtime pluggable.
7. **License handling** — copy upstream `LICENSE` verbatim to `src/vendor/character-studio/NOTICE` with a prepended line: `Vendored from https://github.com/M3-org/CharacterStudio @ <SHA>`.

## Audit checklist

- [ ] Upstream license is MIT (confirm — if it's not, stop and ask before proceeding).
- [ ] No React, JSX, Next.js, or Tailwind references in `src/vendor/character-studio/`.
- [ ] `grep -r "react" src/vendor/character-studio/` returns zero matches in code (descriptions in comments ok but note them).
- [ ] The adapter surface in `src/character/character-manager.js` does not leak upstream internals (consumers should not need to import anything from `src/vendor/`).
- [ ] `NOTICE` file includes upstream URL, commit SHA, and full MIT license text.
- [ ] `node --check src/character/character-manager.js` parses.
- [ ] `npx vite build` completes.

## Constraints

- Vendor only. No npm install of CharacterStudio or its UI deps.
- Do not modify upstream source beyond the minimum required to make imports resolve in our tree. If you must patch, wrap the change in a `// PATCH:` comment explaining why.
- If the upstream depends on a non-MIT package, either use the npm version of that sub-dep or stop and flag it.
- Don't wire up the side-panel UI, hotbar, or any controls. That's task 16.
- Don't modify [src/viewer.js](../../src/viewer.js).

## Verification

1. `node --check` each new JS file.
2. `npx vite build` passes.
3. Smoke test in DevTools console:
   ```js
   const { CharacterManager } = await import('/src/character/character-manager.js');
   const mgr = new CharacterManager({ renderer: VIEWER.app.viewer.renderer });
   await mgr.loadManifest('/character-manifest.example.json');
   VIEWER.app.viewer.scene.add(mgr.getScene());
   ```
   Avatar appears. No console errors.
4. `mgr.dispose()` removes the character and frees GPU resources (verify via `renderer.info.memory`).

## Scope boundaries — do NOT do these

- No editor UI (task 16).
- No asset library (task 17).
- No photo-to-avatar (tasks 07, 08).
- Do not couple `CharacterManager` to the viewer's camera, lights, or controls — keep it scene-graph-only.

## Reporting

- Upstream commit SHA vendored.
- Total bytes of vendored code (`du -sh src/vendor/character-studio`).
- List of files copied (or a `tree` output).
- Any patches applied, with a one-line reason each.
- Any upstream deps that remain as npm installs vs were vendored inline (with rationale).
- Confirmation that the smoke test avatar rendered correctly.
