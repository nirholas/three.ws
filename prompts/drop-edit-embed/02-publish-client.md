# Task 02 — `publishEditedGLB(session, opts)` client helper

## Why this exists

Task 03 adds a "📤 Publish as embed" button. That button needs a single async function it can call to turn the current editor session into a live shareable widget. Keep the transport logic out of the UI — put it in its own file so it's testable and reusable from the Widget Studio and anywhere else.

## Shared context

- The three endpoints you'll call — **read them before you wire** — are:
  - `POST /api/avatars/presign` → [api/avatars/presign.js](../../api/avatars/presign.js). Returns `{ storage_key, upload_url, method: 'PUT', headers: { 'content-type' }, expires_in }`.
  - `POST /api/avatars` → [api/avatars/index.js](../../api/avatars/index.js). Registers an avatar given `{ name, slug, storage_key, content_type, size_bytes, ... }`. Verifies R2 object exists via `headObject()`. Returns `{ avatar: { id, slug, url, ... } }`.
  - `POST /api/widgets` → [api/widgets/index.js](../../api/widgets/index.js). Shape: `{ type: 'turntable', name, avatar_id, config, is_public }`. Returns `{ widget: { id, url, ... } }`.
- Edit-to-bytes is already done: [src/editor/glb-export.js](../../src/editor/glb-export.js) exports `exportEditedGLB(session) → Uint8Array`.
- The `EditorSession` exposes `sourceName` (the original filename or URL tail) — use that as the default avatar name, sanitized.
- Auth is cookie-based for the browser flow (`credentials: 'include'`). The helper does **not** handle login — it throws a typed `AuthRequiredError` and lets the caller redirect. Task 04 wires the redirect.
- Scope needed: `avatars:write` for avatar creation and widget creation (both accept the user session cookie).

## What to build

Create [src/editor/publish.js](../../src/editor/publish.js).

```js
/**
 * Publish an edited GLB as a shareable widget.
 *
 * Steps (all fetch calls use credentials: 'include'):
 *   1. exportEditedGLB(session) → Uint8Array
 *   2. POST /api/avatars/presign  → { storage_key, upload_url, headers }
 *   3. PUT upload_url with the bytes
 *   4. POST /api/avatars          → { avatar }
 *   5. POST /api/widgets { type:'turntable', avatar_id, ... } → { widget }
 *
 * Resolves: { widget, avatar, urls }
 *   urls = {
 *     page:    `${origin}/w/${widget.id}`,
 *     iframe:  `<iframe src="${origin}/w/${widget.id}" width="600" height="600" style="border:0"></iframe>`,
 *     element: `<script type="module" src="${origin}/dist-lib/agent-3d.js"></script>\n` +
 *              `<agent-3d src="${origin}/api/avatars/${avatar.id}" ...></agent-3d>`,
 *   }
 *
 * Rejects:
 *   - AuthRequiredError — 401 from any step
 *   - SizeTooLargeError — export exceeds MAX_BYTES (constant, 25 MB)
 *   - ExportFailedError — export buffer empty or glTF-Transform throws
 *   - PublishError (generic) — any other non-2xx with the server's error_description
 */
export async function publishEditedGLB(session, {
	origin = location.origin,
	widgetType = 'turntable',
	widgetName,          // defaults to sanitized session.sourceName
	isPublic = true,
	config = {},         // merged into widget.config
	onStep = () => {},   // ({ step: 'export'|'presign'|'upload'|'register'|'widget', pct }) for progress UI
} = {}) { … }

export class AuthRequiredError extends Error { constructor(){ super('auth required'); this.name = 'AuthRequiredError'; } }
export class SizeTooLargeError extends Error { constructor(bytes, limit){ super(`${bytes} > ${limit}`); this.name='SizeTooLargeError'; this.bytes=bytes; this.limit=limit; } }
export class ExportFailedError extends Error { constructor(cause){ super(`export failed: ${cause?.message || cause}`); this.name='ExportFailedError'; this.cause=cause; } }
export class PublishError    extends Error { constructor(step, status, body){ super(`${step} failed: ${status} ${body?.error_description||''}`); this.name='PublishError'; this.step=step; this.status=status; this.body=body; } }

export const MAX_BYTES = 25 * 1024 * 1024;
```

### Implementation notes

- `slug` for the avatar POST: lowercase-kebab the session name + a short random suffix. `api/_lib/validate.js` exports `slug` / `slugSchema` — match that shape (validation will reject anything else).
- `content_type`: `model/gltf-binary`.
- `size_bytes`: `bytes.byteLength`.
- The PUT step uses the exact `headers` the presign endpoint returned — **do not add others** (R2 will reject the signed URL). Use `fetch(upload_url, { method:'PUT', body: bytes, headers })`. Do **not** send `credentials: 'include'` on the PUT — the presigned URL carries its own auth.
- On 401 from any step → throw `AuthRequiredError`. Do not retry.
- On 413 from `/api/avatars` → throw `SizeTooLargeError(bytes, MAX_BYTES)`.
- `onStep` emits:
  - `{ step: 'export', pct: 0 }` then `{ step: 'export', pct: 1 }`
  - `{ step: 'presign', pct: 1 }`
  - `{ step: 'upload', pct: 0..1 }` — use `XMLHttpRequest` for real upload progress; `fetch` doesn't give you upload progress in browsers. If you'd rather keep `fetch`, emit `0` at start and `1` on completion — that's acceptable for this task.
  - `{ step: 'register', pct: 1 }`
  - `{ step: 'widget', pct: 1 }`
- Widget `config`: the defaults for `turntable` are in [public/studio/studio.js](../../public/studio/studio.js) (`TYPE_DEFAULTS.turntable` = `{ rotationSpeed: 0.5 }`). Include `{ rotationSpeed: 0.5, autoRotate: true, showControls: true, background: '#0a0a0a', accent: '#8b5cf6' }` as the baseline; shallow-merge caller-supplied `config` on top.

### Do NOT

- Do not import anything from `public/studio/*` — that is intentionally un-transformed by Vite. Duplicate the two default constants locally with a comment pointing to the source.
- Do not add any new dependency. `fetch` + `XMLHttpRequest` + existing `@gltf-transform/core` (via `glb-export.js`) are enough.
- Do not handle auth redirects here — that's task 04.
- Do not handle CORS / size guards client-side other than the `MAX_BYTES` check. Task 06 adds the smarter guards.

## Files you own

- Create: `src/editor/publish.js`

## Files off-limits

- `src/app.js`, `src/editor/index.js` — owned by tasks 01 and 03.
- `src/editor/glb-export.js` — you may import `exportEditedGLB`; do not edit.
- Any `api/*` file — endpoints exist and are stable.
- `public/studio/*` — separate surface.

## Acceptance

- `node --check src/editor/publish.js` passes.
- `npm run verify` passes.
- Manual smoke in DevTools console after loading any model:
  ```js
  const { publishEditedGLB } = await import('/src/editor/publish.js');
  const session = window.VIEWER.editor.session;
  const result = await publishEditedGLB(session, { onStep: (s) => console.log(s) });
  console.log(result.urls);
  ```
  Expected: progress events, resolves with a `{ widget, avatar, urls }` object where `urls.page` is a working `/w/<id>` URL. (You must be signed in; if not, expect `AuthRequiredError` — that's correct.)

## Reporting

Use the template in [00-README.md](./00-README.md). Include the console log from the manual smoke so reviewers can see the step sequence.
