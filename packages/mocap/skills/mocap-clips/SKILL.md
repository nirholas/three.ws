---
name: mocap-clips
description: Save, list, fetch, update and delete motion capture clips on three.ws with @three-ws/mocap. Use when a task needs to store or replay a face, pose or hand recording on an avatar.
---

# Mocap clips with @three-ws/mocap

A thin Node/browser client over the `/api/mocap/clips` endpoints on three.ws. It stores browser-recorded frames and returns them for replay on any avatar.

## Install

```
npm install @three-ws/mocap
```

Node 18 or newer. Zero dependencies. The base URL defaults to `https://three.ws` and can be overridden with the `baseUrl` option or the `THREE_WS_BASE_URL` env var.

## Auth

Writes need a session cookie or a bearer token with the right scope. Reads of public clips are open. Pass the token per call or bind it once:

```js
import { createMocap } from '@three-ws/mocap';
const mocap = createMocap({ token: process.env.THREEWS_TOKEN });
```

Cookie-authenticated writes also need `X-CSRF-Token` (mint one with `GET /api/csrf-token`). Bearer tokens do not.

## Functions

All are exported both as top-level functions and on the `createMocap()` client.

- `saveClip(recording, meta, auth?)`: `POST /api/mocap/clips`. `meta.name` is required (1 to 120 chars). Optional `slug`, `description`, `tags`, `visibility` (`private` | `unlisted` | `public`), `avatarId`.
- `getClip(idOrSlug, auth?)`: one clip with its full `frames`.
- `listClips(auth?, { limit, cursor, kind, includePublic })`: metadata only, returns `{ items, nextCursor }`. `kind` is `face`, `pose`, `hand` or `vmc`.
- `updateClip(idOrSlug, patch, auth?)`: owner only. Patch may include `name`, `description`, `tags`, `visibility`, `avatarId`, `price`.
- `deleteClip(idOrSlug, auth?)`: soft delete, returns `{ ok }`.
- `supportedFormats`, `formatKind(format)`: helpers.

## Recording shape

```js
{ format: 'three.ws.face-mocap.v1', duration: 2.4, frames: [{ t: 0, shapes: { jawOpen: 0.1 }, mat: null }] }
```

Supported `format` values: `three.ws.face-mocap.v1`, `three.ws.pose-mocap.v1`, `three.ws.hand-mocap.v1`, `three.ws.vmc.v1`. At most 18000 frames per clip.

## Example

```js
import { saveClip, getClip, listClips } from '@three-ws/mocap';

const token = process.env.THREEWS_TOKEN;
const clip = await saveClip(recording, { name: 'Wave hello', visibility: 'unlisted', tags: ['wave'] }, { token });
const full = await getClip(clip.slug ?? clip.id, { token });
const mine = await listClips({ token }, { kind: 'face', limit: 20 });
```

## Errors

Failures throw `ThreeWsError` (`code`, `status`, `detail`, `retryAfter`). A 402 throws `PaymentRequiredError` with the x402 `accepts` challenge. Do not retry a 402 without the user approving the payment.

Frames come from a webcam or video capture running in the browser. This package does not capture, it persists and fetches.
