# 05 — Avaturn client bridge

## Why

The backend [api/onboarding/avaturn-session.js](../../api/onboarding/avaturn-session.js) exists and returns `{ session_url, expires_at }` for a set of captured photos. No client wraps it. Without this module, captured photos have no path to an actual GLB.

## Parallel-safety

Pure client module. You create ONE file. No route wiring; a sibling/later prompt connects this to the camera module.

## Files you own

- Create: `src/avaturn-client.js`

## Read first

- [api/onboarding/avaturn-session.js](../../api/onboarding/avaturn-session.js) — shape of request (`{ photos: { front, left, right } }` — confirm by reading) and response.

## Deliverable

```js
export async function createAvaturnSession({ front, left, right })
// POST /api/onboarding/avaturn-session with the three base64 JPEGs (data URLs).
// Returns { sessionUrl, expiresAt } or throws a typed error.

export async function awaitAvatarGLB({ sessionUrl, onProgress, signal })
// Opens the Avaturn session inside a hidden iframe, listens via postMessage for
// the 'avatar.ready' / 'avatar.exported' event with a GLB URL, fetches the GLB,
// returns { glbBytes: ArrayBuffer, thumbnailUrl?: string, metadata?: object }.
// onProgress({ step, pct }) fires with steps: 'iframe-load' | 'avatar-gen' | 'glb-fetch'.
// signal is an AbortSignal; on abort, tear down the iframe and reject with AbortError.

export class AvaturnError extends Error {} // name === 'AvaturnError', has .code: 'quota' | 'auth' | 'session-expired' | 'network' | 'timeout'
```

Implementation notes:

- `blobToDataUrl(blob)` helper to convert the JPEG `Blob`s from the camera module.
- The hidden iframe mounts at `document.body` with `style.display = 'none'`, `sandbox="allow-scripts allow-same-origin"`. Confirm Avaturn's actual sandbox requirements — if it needs more, widen minimally and note it.
- `postMessage` listener scoped to the iframe's `contentWindow`; ignore messages from other sources.
- Overall timeout: 120s from `awaitAvatarGLB` start → reject with `AvaturnError('timeout')`.
- If the server returned `expires_at` before now + 10s, reject immediately with `AvaturnError('session-expired')`.

## Constraints

- No new deps.
- Do not hardcode Avaturn's origin; derive it from `sessionUrl`.
- Do not log GLB bytes or any raw photo data.

## Acceptance

- `node --check` clean.
- `npm run build` clean.
- Integration is NOT required for acceptance — a sibling prompt wires this to the camera module. Include a small doc-comment example at the top of the file showing the intended use.

## Report

- Exact Avaturn postMessage event shape you coded against (cite their docs or the existing code that references them).
- Whether you needed to loosen the iframe sandbox.
