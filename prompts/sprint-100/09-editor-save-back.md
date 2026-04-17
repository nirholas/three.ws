# 09 — Editor save-back button (client)

## Why

Editor can export GLB bytes ([src/editor/glb-export.js](../../src/editor/glb-export.js)) but doesn't push them anywhere. This adds a client module that exports → presigned-uploads to R2 → calls `PATCH /api/avatars/:id`.

## Parallel-safety

New client module. You make ONE additive edit to [src/editor/index.js](../../src/editor/index.js) to wire a "💾 save edits" control, under 10 lines. The `PATCH /api/avatars/:id` endpoint may or may not exist yet (sibling prompt 08 builds it) — this module calls it anyway and surfaces any error gracefully.

## Files you own

- Create: `src/editor/save-back.js`
- Edit (<10 lines additive): [src/editor/index.js](../../src/editor/index.js) — add a control in `_addExportFolder()` after the download-GLB row.

## Read first

- [src/editor/glb-export.js](../../src/editor/glb-export.js) — has `exportCurrentGLB(session)` or similar; confirm the export entry point.
- [src/editor/publish.js](../../src/editor/publish.js) — already does a similar dance for widget publish; reuse its presign helpers if they're exported. If they're private, do not refactor — duplicate the minimal code you need.
- [api/avatars/presign.js](../../api/avatars/presign.js) — presign contract.

## Deliverable

`src/editor/save-back.js` exports:

```js
export async function saveEditedAvatar(session, { avatarId, onStep })
// 1. Export GLB bytes from the editor session.
// 2. POST /api/avatars/presign with { size, contentType: 'model/gltf-binary', purpose: 'avatar-edit' }.
// 3. PUT the bytes to the returned signed URL.
// 4. PATCH /api/avatars/:id with { glbUrl: <the non-signed R2 URL> }.
// onStep({ step: 'export'|'presign'|'upload'|'patch', pct }).
// Returns { ok: true, avatar } or throws with a .code of 'auth' | 'oversize' | 'network' | 'server'.
```

### Editor control

In `_addExportFolder()` add:

```js
folder.add({ save: () => this._saveEdits() }, 'save').name('💾 save edits');
```

`_saveEdits()` on the `Editor` class:

- Requires `this.session.avatarId`. If missing (dropped GLB, not a saved avatar), show a toast "Not a saved avatar — use Publish instead" and return.
- Dynamic-import `./save-back.js` and call `saveEditedAvatar`.
- Show a tiny non-modal status text in the editor folder during the save ("saving… 42%"). On success, flash "saved ✓" for ~1.5s. On 401, show "Sign in to save" with a link to `/login?next=<current>`.

## Constraints

- No modal. Non-blocking save.
- No new deps.
- If `session.avatarId` isn't on the session object, fallback to `new URLSearchParams(location.search).get('avatarId')`.

## Acceptance

- `node --check src/editor/save-back.js` passes.
- `npm run build` clean.
- With the PATCH endpoint live: edit an avatar, click Save → refresh the page → edits persisted.
- Without the endpoint live: click Save → clear error toast, no console spam.

## Report

- Whether `exportCurrentGLB` was already exported or needed to be called via an existing public method.
- Full terminal output of `node --check` and `npm run build`.
