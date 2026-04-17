# Task 01 — Editor attaches reliably on any imported GLB

## Why this exists

Every downstream task in this band assumes the Editor is available and wired to whatever GLB the user has loaded. Before we add a "Publish as embed" button, we need to confirm (and fix if needed) that the Editor actually attaches in all three import paths: drag-drop, URL-hash `#model=`, and file picker.

The `Editor` class in [src/editor/index.js](../../src/editor/index.js) already exposes `attach()` (one-time) and `onContentChanged({ url, file, name })` (per load). It needs to be:

1. Constructed once, after the `Viewer` is constructed.
2. `attach()`'d once.
3. Called `onContentChanged(...)` every time a model loads — drag-drop, URL, or internal re-load.

## Shared context

- [src/app.js](../../src/app.js) is the main SPA entry. It constructs the `Viewer` and handles the dropzone + URL hash.
    - Search for where `new Viewer(...)` is called and where model loads happen (`view()`, `load()`).
- The `Editor` import is `import { Editor } from './editor/index.js';` (already imported on app.js line ~4).
- `EditorSession.reset({ url, file, name })` in [src/editor/session.js](../../src/editor/session.js) is what the editor uses to track the source for export. If `onContentChanged` isn't called, `session.getSourceBuffer()` will return null and GLB export fails silently later.
- The editor renders into `viewer.gui` (dat.gui). If the viewer is in kiosk mode (no gui), the editor currently degrades gracefully (see `_addExportFolder()` early-return). Leave that as-is.

## What to build

### 1. Audit the current wiring

Read [src/app.js](../../src/app.js) end-to-end and answer (in your reporting block):

- Where is the Editor instantiated?
- Is `editor.attach()` called once?
- Is `editor.onContentChanged(...)` called in every code path that loads a model? Specifically: drag-drop (`load()`), URL-hash model (`view()`), and any internal re-load (`viewer.load()` that doesn't go through `App.view()`).

### 2. Fix any missing calls

Wire `editor.onContentChanged(...)` into every load path with the correct `{ url, file, name }`:

- Drag-drop: `{ file: <File>, name: <file.name> }`
- URL-hash / remote fetch: `{ url: <string>, name: <basename(url)> }`
- Re-load after edit (if any): pass the current source

Do **not** call `attach()` more than once.

### 3. Do not regress kiosk mode

If `this.options.kiosk` is true, the Editor should either not construct or not `attach()` — keep the old behavior. Look at how the viewer disables its GUI in kiosk mode and mirror that decision.

### 4. Handle the "no source buffer" failure loudly (not silently)

If `onContentChanged` ever gets called with neither `url` nor `file`, the export will fail later. Have `EditorSession.reset()` log a warning (`console.warn('[editor] no source — export disabled')`) and have the Editor disable its export control visually (gray it out) until a valid source lands. This unblocks Task 03, which otherwise can't tell why publish silently fails.

## Files you own

- Edit: [src/app.js](../../src/app.js) — add or move `onContentChanged(...)` calls into each load path.
- Edit: [src/editor/session.js](../../src/editor/session.js) — add the warn + a getter like `isExportReady()`.
- Edit: [src/editor/index.js](../../src/editor/index.js) — gray out the export control when `!session.isExportReady()`; update when `session.onChange` fires.

## Files off-limits

- `src/editor/glb-export.js` — owned by task 02 (publish client may change call signatures).
- `src/editor/material-editor.js`, `src/editor/texture-inspector.js`, `src/editor/scene-explorer.js` — not in this task.
- Any `api/*` file — not in this task.
- `public/studio/*` — separate surface.

## Acceptance

- Load [http://localhost:3000](http://localhost:3000), drag a `.glb` onto the page → Editor folder appears, scene panel renders, export control is enabled.
- Load [http://localhost:3000/#model=https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb](http://localhost:3000/#model=https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Fox/glTF-Binary/Fox.glb) → Editor folder appears, export control is enabled.
- Load [http://localhost:3000/#kiosk=true&model=…](http://localhost:3000/#kiosk=true&model=…) → no Editor folder, no errors.
- Tweak a material color, click `💾 download GLB` → file saves correctly (regression check).
- `window.VIEWER.editor.session.isExportReady()` returns `true` after any successful load.

## Reporting

Include the audit findings (what was broken) + the exact patches + the manual-verification outcomes. Use the reporting template in [00-README.md](./00-README.md).
