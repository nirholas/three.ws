# 05-01 — Claude Artifact single-file bundle for an agent

**Pillar 5 — Host embed (Claude Artifacts + Lobehub).** Stack layer 5 — the novel unlock.

## Why it matters

Claude Artifacts render a **single HTML file** in a sandboxed iframe. No external modules (unless via esm.sh / unpkg), no cookies to our origin, no back-channel auth. If our agent can render *inside an Artifact* — visible, speaking, expressive — that's the category shift from "agent is JSON" to "agent is present." This is the #5 pillar.

## What to build

A generator `GET /api/agents/:id/artifact.html` that returns a **self-contained HTML file** which:

1. Boots a Three.js scene from an esm.sh CDN import.
2. Fetches the agent's GLB URL + identity manifest from our public APIs (`/api/agents/:id` + `/api/avatars/:avatar_id`).
3. Renders the avatar with the Empathy Layer active but read-only (no server writes from inside an Artifact).
4. Listens to parent-window messages for `speak`, `emote`, `gesture`, `look-at` so the host chat can drive the agent.
5. Self-contained: the only external fetches are our public APIs and the R2-backed GLB URL (CORS set).

The artifact embed URL is the copyable snippet from `04-06` for the `claude-artifact` target.

## Read these first

| File | Why |
|:---|:---|
| [public/agent/embed.html](../../public/agent/embed.html) | Closest existing sibling. Artifact version is embed.html minus cookie-auth and plus CDN-only imports. |
| [src/agent-protocol.js](../../src/agent-protocol.js) | Event vocabulary — same bus inside the artifact. |
| [src/agent-avatar.js](../../src/agent-avatar.js) | Empathy Layer — must load via dynamic CDN import. |
| [src/viewer.js](../../src/viewer.js) | Viewer class, its imports. |
| [api/agents.js](../../api/agents.js) | Public GET `/api/agents/:id` returns public fields when unauthenticated. |
| [api/avatars/index.js](../../api/avatars/index.js) | Public avatar fetch: ensure `GET /api/avatars/:id` returns a CDN URL for `visibility='public'|'unlisted'` without auth. If not, extend. |

## Build this

### 1. Public avatar fetch

The artifact runs in a cross-origin sandbox. Verify `GET /api/avatars/:id`:

- If the avatar is `visibility='public'` or `'unlisted'` → return GLB CDN URL + minimal metadata, no auth required.
- If `'private'` → 403. (Cannot embed private avatars in artifacts.)
- Response must include `Access-Control-Allow-Origin: *` for these reads.

### 2. The generator endpoint

`GET /api/agents/:id/artifact.html`:

- Look up the agent (public fields only).
- Reject if the avatar is private → 403 JSON.
- Render a single HTML string that inlines:
  - Title, noindex meta.
  - Inline CSS (transparent bg, full viewport, no scroll).
  - A single `<script type="module">` with the boot logic.
- Set `Content-Type: text/html; charset=utf-8` and `Cache-Control: public, max-age=60, stale-while-revalidate=600`.

Template literals for the HTML string; no SSR framework.

### 3. The inline boot script

```js
import * as THREE from 'https://esm.sh/three@0.176.0';
import { GLTFLoader } from 'https://esm.sh/three@0.176.0/examples/jsm/loaders/GLTFLoader.js';
// Minimal scene: scene, camera, renderer, ambient + key light.
// Fetch /api/agents/${agentId} + /api/avatars/${avatarId}.
// Load GLB via GLTFLoader. Center + scale.
// Minimal emotion layer: map incoming postMessage events to blend weights.
// Animate loop with decay per frame.
```

The Empathy Layer from [src/agent-avatar.js](../../src/agent-avatar.js) has to be ported to a minimal form here (not imported — artifacts can't fetch from our origin via module graph reliably). Keep it under 200 lines.

### 4. postMessage contract (inbound)

Listen for messages with shape `{ __agent: <id>, type, payload }`:

| Type | Payload | Effect |
|:---|:---|:---|
| `speak` | `{ text, sentiment }` | Log + nudge emotion blend (no TTS in artifact) |
| `emote` | `{ trigger, weight }` | Add to blend |
| `gesture` | `{ name, duration }` | One-shot morph target pop |
| `look-at` | `{ target: 'user'\|'camera' }` | Orient head |

Validate `event.origin` against an allowlist: `https://claude.ai`, `https://*.lobehub.com`, and the embedder's own origin. Log + ignore everything else.

### 5. postMessage contract (outbound)

On boot, post `{ __agent: id, type: 'ready', name }` to `parent`. On avatar load error, post `{ __agent: id, type: 'error', message }`.

### 6. Sizing

Respect `?size=bubble|card|banner|full&bg=transparent|#hex` query params (same vocabulary as 04-05).

## Out of scope

- Do not enable chat inside the artifact. The agent is visible and reactive to postMessages; conversation happens in the host chat.
- Do not enable on-chain actions inside the artifact (no wallet there).
- Do not serve this URL as an `<iframe>` alternative to `/agent/:id/embed` — that URL stays as-is. This is a separate target because Claude's sandboxing is stricter.
- Do not include `src/*` imports — inline everything the artifact needs.

## Deliverables

**New:**
- `api/agents/[id]/artifact.js` — the generator.
- Tiny unit of the Empathy Layer inlined into the HTML template. Keep it short.

**Modified:**
- [api/avatars/index.js](../../api/avatars/index.js) (or the `[id].js` variant — check) — ensure public/unlisted avatars return GLB URL without auth + permissive CORS.
- `vercel.json` — route `/api/agents/:id/artifact.html`.

## Acceptance

- [ ] Visiting `https://3dagent.vercel.app/api/agents/<id>/artifact.html` directly renders the avatar in the browser.
- [ ] Embedding that URL inside a Claude Artifact sandbox renders the avatar, no errors in the artifact's console.
- [ ] Posting `{ __agent, type: 'emote', payload: { trigger: 'celebrate', weight: 0.7 } }` from the parent → avatar reacts.
- [ ] Private avatars return 403.
- [ ] `npm run build` passes.

## Test plan

1. Verify GLB fetch from a clean `curl -I` with no cookies returns 200 + `Access-Control-Allow-Origin: *`.
2. Open the artifact URL in a normal browser → avatar renders.
3. Paste this into a Claude Artifact:
   ```html
   <iframe src="https://3dagent.vercel.app/api/agents/<id>/artifact.html" style="width:100%;height:400px;border:0;background:transparent"></iframe>
   ```
   Confirm it renders.
4. From parent page console: `frames[0].postMessage({ __agent: '<id>', type: 'emote', payload: { trigger: 'celebrate', weight: 0.8 } }, '*')` → avatar reacts.
5. Try with a private avatar → artifact shows a clear error message, not a blank.
