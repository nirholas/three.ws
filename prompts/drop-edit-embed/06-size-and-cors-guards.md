# Task 06 — File size limits + CORS-blocked GLB handling

## Why this exists

Task 02 added a single 25 MB size check. That's the easy half. The harder failure modes live in two spots:

1. **Server-side size policy** — plan quotas exist in the `plan_quotas` table. A free user may be under a stricter cap than 25 MB per avatar. Today the editor client doesn't know; it hits `/api/avatars/presign` and gets a cryptic 413.
2. **Remote GLBs loaded via `#model=<url>`** — the editor _can_ display them (the viewer fetches them), but the editor's `EditorSession.getSourceBuffer()` may or may not have kept the original bytes, and re-fetching cross-origin often fails at CORS. Exporting then fails silently or with a confusing error.

We surface both failures with useful error copy, blocks them before users upload, and gives one clear remediation for each.

## Shared context

- Plan quotas live in the `plan_quotas` table ([api/\_lib/schema.sql](../../api/_lib/schema.sql)) and are read by endpoints that need them — search for `plan_quotas` to see where.
- [api/avatars/index.js](../../api/avatars/index.js) returns 413 with `error: 'payload_too_large'` and an `error_description` if size exceeds the user's plan.
- `EditorSession` in [src/editor/session.js](../../src/editor/session.js) exposes `getSourceBuffer()`. Check whether it caches the bytes on load or re-fetches on demand; if it re-fetches, CORS will bite on cross-origin URLs loaded via `#model=`.
- The viewer's load path goes through `GLTFLoader` which internally manages fetching. We need to capture the bytes _at load time_ regardless of how the viewer fetched them, then hand them to the editor session.

## What to build

### 1. New endpoint: `GET /api/me/limits`

Create [api/me/limits.js](../../api/me/limits.js). Returns the caller's avatar size limit:

```json
{
	"max_avatars": 20,
	"max_bytes_per_avatar": 26214400,
	"max_total_bytes": 524288000,
	"current_total_bytes": 48271934
}
```

- Auth: session cookie or bearer with `avatars:read`.
- Read `users.plan` → look up `plan_quotas` → count `avatars` bytes for this user.
- Rate-limit via `limits.authIp(clientIp(req))`.
- Use `json()`, `error()`, `wrap()`, `cors()` exactly like other endpoints.
- Cache header: `private, max-age=60` (stat changes with every upload).

Add the route to [vercel.json](../../vercel.json) next to the other `/api/me/*` routes. If there aren't any, add under the `/api/*` passthrough. Keep the edit to one or two lines.

### 2. Prefetch on editor boot

In [src/editor/index.js](../../src/editor/index.js) `attach()`, call `/api/me/limits` once and cache the result on `this.limits`. If the request fails (user signed out), leave `this.limits = null` — task 04 will still route them through login at publish time.

### 3. Client guard in `publish.js`

In [src/editor/publish.js](../../src/editor/publish.js), before POSTing presign:

- If `opts.limits` is passed and `bytes.byteLength > opts.limits.max_bytes_per_avatar`, throw `SizeTooLargeError(bytes.byteLength, opts.limits.max_bytes_per_avatar)`.
- Also keep the static `MAX_BYTES` fallback when `opts.limits` is absent.

In [src/editor/index.js](../../src/editor/index.js) `_openPublishModal()`, pass `{ limits: this.limits }` through.

### 4. Capture source bytes at load time

Edit [src/editor/session.js](../../src/editor/session.js) `reset({ url, file, name })`:

- If `file` is a `File` or `Blob` → read it once with `await file.arrayBuffer()` and cache on `this._sourceBytes`.
- If `url` is provided → attempt one `fetch(url, { credentials: 'omit' })`; on success cache the `ArrayBuffer` in `this._sourceBytes`; on CORS / network failure, set `this._sourceBytes = null` and store the failure reason in `this._sourceBytesError = { url, reason }`.
- Replace `getSourceBuffer()` with:
    - If `_sourceBytes` → return it.
    - Else if `_sourceBytesError` → throw a new typed `SourceFetchError` with copy: "Couldn't re-read the model bytes for export. Most often this is a CORS issue with the host. Try: (1) hosting the GLB on the same origin, or (2) drag-and-dropping the file directly."
    - Else throw `new Error('No source buffer for export')` (existing behavior).

Export `SourceFetchError` from `src/editor/session.js` so `publish.js` can wrap it as `ExportFailedError` with the same copy.

### 5. Modal copy

In [src/editor/publish-modal.js](../../src/editor/publish-modal.js) `showError(err)`:

- `SizeTooLargeError` → "Your edited model is X MB, but your plan allows Y MB per avatar. Trim textures or decimate meshes, or upgrade your plan." Include a "How to trim" link — for now, link to [docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md) anchor `#compressing-gltf`; adding that anchor is out of scope for this task, so note it in the reporting block.
- `SourceFetchError` (or `ExportFailedError` wrapping it) → the CORS copy from section 4.
- Generic `PublishError` → `err.body?.error_description || err.message`, plus an unstyled "retry" button that just re-runs the same flow.

## Files you own

- Create: [api/me/limits.js](../../api/me/limits.js)
- Edit: [vercel.json](../../vercel.json) — one or two route lines.
- Edit: [src/editor/index.js](../../src/editor/index.js) — prefetch `/api/me/limits`; thread `limits` into publish call.
- Edit: [src/editor/session.js](../../src/editor/session.js) — capture bytes on load; new error type.
- Edit: [src/editor/publish.js](../../src/editor/publish.js) — honor `opts.limits`.
- Edit: [src/editor/publish-modal.js](../../src/editor/publish-modal.js) — error copy.

## Files off-limits

- Other `api/*` endpoints — not in scope.
- `api/_lib/schema.sql` — schema changes are a separate conversation. If `plan_quotas` is missing a column you need, ask, don't migrate.
- Anything under `public/studio/*`, `public/widgets-gallery/*`.
- `src/editor/material-editor.js`, `texture-inspector.js`, `scene-explorer.js`, `glb-export.js`.

## Acceptance

- Signed-in user hits `/api/me/limits` → gets JSON with their plan's numbers.
- Drop a big GLB (synthesize one with `dd if=/dev/urandom of=fake.glb bs=1M count=30` for local testing — it will fail export but the size check hits first in step 3). The modal surfaces the plan cap and the size.
- Load a cross-origin GLB that blocks CORS (e.g. `#model=https://somewhere-without-cors/foo.glb`) → try to publish → get the CORS-remediation copy, NOT a silent failure.
- Load a same-origin GLB → publish works end-to-end as before.
- Drag-and-drop path is unaffected (file bytes are cached straight from the `File`).

## Reporting

Use the template in [00-README.md](./00-README.md). Flag the docs anchor (`#compressing-gltf`) as a separate TODO — do not fix it in this PR.
