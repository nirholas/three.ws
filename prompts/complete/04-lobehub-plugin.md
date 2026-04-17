# 04 — LobeHub plugin manifest + iframe handshake

## Why

Band 5 gap: no shipped LobeHub plugin. Even if we can't get merged into LobeHub's registry today, we can ship a **plugin-shaped** bundle they (or a LobeHub fork operator) can drop in. The spec folder [prompts/lobehub-embed/](../lobehub-embed/) has the design; this prompt ships the minimum viable plugin surface.

**No external submissions.** Everything lives in our repo. Submission PR is out of scope.

## What to build

### 1. Plugin manifest

Create `public/lobehub/plugin.json` — follows the LobeHub plugin manifest v1 shape (look up the current schema; if you can't access it, use a best-effort version matching the fields in [prompts/lobehub-embed/01-plugin-manifest.md](../lobehub-embed/01-plugin-manifest.md)). Fields:

- `identifier`: `3d-agent`
- `version`: `0.1.0`
- `api[]`: one entry pointing at our MCP-compatible endpoints
- `ui.iframe.url`: `https://3dagent.vercel.app/lobehub/iframe`
- `ui.iframe.height`: `480`
- `meta`: title, description, avatar (use our repo avatar), tags

### 2. Plugin iframe page

Create `public/lobehub/iframe/index.html` — minimal page that:

- Loads `<agent-3d>` (lazy).
- Accepts an `?agent=<id>` param.
- Implements the `postMessage` handshake from [prompts/lobehub-embed/02-iframe-handshake.md](../lobehub-embed/02-iframe-handshake.md) — at minimum: `ready`, `resize`, and `action` messages. Origin check against a documented allowlist (`chat.lobehub.com`, `lobechat.ai`, `*`, dev hosts).
- Forwards protocol-bus events (`speak`, `skill-done`, etc.) up to the parent via `postMessage({ type: 'agent-event', detail: ... })`.

### 3. Handshake endpoint

Create `api/lobehub/handshake.js` — POST-only JSON endpoint that, given `{ agentId, hostOrigin }`, returns `{ ok: true, iframeUrl, embedPolicy }`. This lets LobeHub pre-validate the agent before rendering the iframe (avoiding a broken iframe on unknown agents).

Use `sql` from [api/\_lib/db.js](../../api/_lib/db.js) to look up `agents` by id — return 404 if missing. Use `json()` / `error()` from [api/\_lib/http.js](../../api/_lib/http.js). Rate-limit with `limits.publicRead`.

### 4. Manifest serving endpoint

Create `api/lobehub/manifest.js` — GET-only, returns the contents of `public/lobehub/plugin.json` with `Content-Type: application/json`, `Cache-Control: public, max-age=300`. Exists so the manifest is resolvable at a clean URL (`/api/lobehub/manifest`) even if Vercel's static serving changes.

### 5. Docs

Create `public/lobehub/README.md` covering:

- How to install the plugin into a LobeHub fork (the operator task).
- postMessage contract (types, payload shapes, origin rules).
- What the plugin does NOT do yet (any LobeHub features we skipped).
- Links to related specs in [prompts/lobehub-embed/](../lobehub-embed/).

## Files you own

- Create: `public/lobehub/plugin.json`
- Create: `public/lobehub/iframe/index.html`
- Create: `public/lobehub/iframe/boot.js`
- Create: `public/lobehub/README.md`
- Create: `api/lobehub/handshake.js`
- Create: `api/lobehub/manifest.js`

## Files off-limits

- `api/mcp.js` — the iframe can consume it, but don't modify.
- `src/element.js` — read-only; use the existing `<agent-3d>` attributes.
- Any file under `prompts/lobehub-embed/` — those are design docs for a different sprint.

## Acceptance

- `GET /api/lobehub/manifest` returns 200 with valid JSON.
- `POST /api/lobehub/handshake` with `{ agentId: '<known>' }` returns `{ ok: true }`; with `{ agentId: 'does-not-exist' }` returns 404.
- Opening `/lobehub/iframe/?agent=<id>` in an iframe and posting `{ type: 'handshake' }` from the parent window gets back a `{ type: 'ready' }` response.
- `node --check` passes on both API files and `boot.js`.

## Reporting

LobeHub manifest schema version used + source URL, postMessage types wired, list of any LobeHub features explicitly skipped.
