# Task: Bridge the captured selfie into an Avaturn session and return a GLB

## Context

Repo: `/workspaces/3D`. The captured-image flow (prompt 01) produces a JPEG `Blob` and hands it to `onCaptureReady(blob)` from `src/selfie-capture.js`. This task fills in that callback: the blob must round-trip through Avaturn and come back as a GLB URL ready for the next step (pinning to R2 + attaching to an identity).

Current Avaturn wiring lives in [src/avatar-creator.js](../../src/avatar-creator.js). It opens the generic customization iframe and subscribes to `sdk.on('export', …)`. The SDK is already a runtime dep (`@avaturn/sdk` in [package.json](../../package.json)) — the pre-existing Vite resolution warning is unrelated to this task; ignore it.

You are adding a photo-driven entry point, not replacing the editor flow. Users who skip the selfie still go through the old flow.

## Goal

Ship a single exported async function that takes a selfie `Blob` and resolves to a GLB URL (plus an optional thumbnail URL), with real error semantics for the three failures we expect in production: **quota exhausted**, **session timeout**, and **pipeline failure**.

Shape:

```js
// src/selfie-pipeline.js
/**
 * @param {Blob} photoBlob
 * @param {{ signal?: AbortSignal, onProgress?: (stage: string) => void }} [opts]
 * @returns {Promise<{ glbUrl: string, thumbnailUrl?: string, avaturnSessionId?: string }>}
 */
export async function createAvatarFromSelfie(photoBlob, opts) { ... }
```

Callers receive structured errors:

```js
class SelfieAvatarError extends Error {
  constructor(code, message, cause) { super(message); this.code = code; this.cause = cause; }
}
// code ∈ 'quota_exceeded' | 'session_timeout' | 'pipeline_failed' | 'invalid_photo' | 'network'
```

## Deliverable

1. **New file: `src/selfie-pipeline.js`** — exports `createAvatarFromSelfie` and `SelfieAvatarError`.
2. **Edit [src/selfie-capture.js](../../src/selfie-capture.js)** (from prompt 01) — in its `onCaptureReady` wiring (or in the `/create` host page `public/create.html`), import `createAvatarFromSelfie`, show a progress state, and on success hand the `{ glbUrl }` to a next-step seam named `onGlbReady(glbUrl, { thumbnailUrl, avaturnSessionId })`. Prompt 03 implements that seam. Leave it as a single callback — do not inline persistence here.
3. **Edit [public/create.html](../../public/create.html)** — render the progress UI: an indeterminate spinner, a live stage label (`"Uploading photo…"` → `"Generating avatar…"` → `"Finalising…"`), and an error panel with a Try-again button.

## Audit checklist — must handle all of these

**Input validation**
- Reject blobs with `blob.type` not in `['image/jpeg', 'image/png', 'image/webp']` → `invalid_photo`.
- Reject blobs `size > 10 * 1024 * 1024` → `invalid_photo` (prompt 01 already caps this; enforce defensively).

**Photo upload step**
- `POST /api/avatars/presign` with `content_type: blob.type`, `size_bytes: blob.size`. Shape of the presign endpoint is locked today in [api/avatars/presign.js](../../api/avatars/presign.js). See also [src/account.js](../../src/account.js) `saveRemoteGlbToAccount` for a working client example of the same handshake.
- `PUT` the blob to `presign.upload_url` with the `content-type` header Avaturn will see.
- If the presign call returns `401` → throw `SelfieAvatarError('quota_exceeded'?, …)` → actually map `401` to `pipeline_failed` with a message "sign in required" — quota is `429`. Do not silently sign the user out.
- If presign returns `429` → `quota_exceeded`.
- Emit `opts.onProgress('uploading_photo')` before and `'photo_uploaded'` after.

**Avaturn handoff**
- Prefer an SDK entry point that accepts a seed photo URL — check `@avaturn/sdk` for `createFromPhoto`, `photoAvatar`, `fromImage`, or equivalent. If none exists, document in a JSDoc comment on the function which symbol you actually called and why.
- Pass the *public* URL form of the uploaded seed (from presign response — most likely a signed GET URL since the avatar is still private). If the SDK requires CORS-enabled URLs, note in the JSDoc.
- Subscribe to the same `export` event the existing [src/avatar-creator.js](../../src/avatar-creator.js) listens for, plus any `error` / `session-timeout` / `quota-exceeded` events the SDK emits.
- Wrap the whole Avaturn step in a 90s timeout via `AbortSignal.timeout(90_000)` combined with `opts.signal`. If both fire, the user's abort wins semantically.
- Emit `onProgress('generating_avatar')` before and `'avatar_ready'` after.

**Error mapping**
| SDK / HTTP condition | `code` | UX message |
|---|---|---|
| Blob fails validation | `invalid_photo` | "That photo can't be used. Try a different one." |
| Presign 429 / Avaturn quota event | `quota_exceeded` | "You've hit today's avatar limit. Try again tomorrow." |
| Avaturn timeout (90s) | `session_timeout` | "Avatar service is slow. Try again." |
| Network `fetch` throws / aborts without timeout | `network` | "Lost connection. Retry when you're back online." |
| Anything else | `pipeline_failed` | "Something went wrong. Try again." |

Log the full underlying error on `console.error` with a `[selfie-pipeline]` prefix — never swallow it silently.

**Teardown**
- On abort or failure, call `sdk.destroy()` if the SDK was initialised.
- Revoke any `URL.createObjectURL` you allocated.
- Do not leave the Avaturn iframe container mounted after the function returns — whether success or failure.

**UX in create.html**
- Progress is one visible string at a time, driven by `onProgress`.
- The Try-again button re-calls `createAvatarFromSelfie(blob, …)` with the same blob (cache it in memory; do not re-prompt the camera).
- Error panel surfaces the `code` as a subtle `data-error-code` attribute for QA / analytics, and the human message as the visible text.

## Constraints

- No new runtime dependencies. Only `@avaturn/sdk` + built-ins.
- Do not persist the blob or the GLB anywhere in this task. Prompt 03 owns persistence.
- Do not call `/api/avatars` (the register endpoint). That's also prompt 03.
- Do not collect name / description here. Prompt 04 owns that.
- Must be safe to call concurrently with the existing `AvatarCreator` flow — pick distinct iframe container element IDs so a stale Avaturn iframe can't be grabbed by the wrong listener.

## Verification

1. `node --check src/selfie-pipeline.js` — parses.
2. `node --check src/selfie-capture.js` + `node --check public/create.html`'s inline module (or `node --check` the extracted module file) — all pass.
3. `npx vite build` — passes. Pre-existing `@avaturn/sdk` resolution warning is expected; any new error is yours.
4. Manual happy path: `/create` → capture → within ~60s, progress transitions fire in order and `onGlbReady` is invoked with a valid `glbUrl` that returns a `model/gltf-binary` response to a `HEAD` fetch.
5. Manual timeout: temporarily set the internal timeout to 2s, capture, confirm UI shows the `session_timeout` message and Try-again works.
6. Manual quota: mock `/api/avatars/presign` to `429`, confirm `quota_exceeded` UX.
7. Manual offline: DevTools Offline, capture, confirm `network` error and retry path.
8. Manual abort: start the pipeline, navigate away (`pagehide`), confirm no console error and no orphan Avaturn iframe remains.

## Scope boundaries — do NOT do these

- Do not redesign [src/avatar-creator.js](../../src/avatar-creator.js). The editor flow is unchanged.
- Do not add image preprocessing (face alignment, background removal, resizing beyond what the capture UI already does).
- Do not add a progress percentage — stage labels only.
- Do not persist the GLB URL to the backend. Prompt 03 does.
- Do not create an `agent_identities` row. Prompt 03 does.
- Do not add analytics events beyond `data-error-code`.

## Reporting

Report:
- Files created and their line counts.
- Files edited and which sections.
- The exact `@avaturn/sdk` symbol you used for the photo entry point and why.
- `node --check` and `npx vite build` output.
- Manual verification results for happy path, timeout, quota, offline, abort.
- Any SDK event you expected but did not find (so the next task author can patch around it).
- Any unrelated bug you spotted (do not fix).
