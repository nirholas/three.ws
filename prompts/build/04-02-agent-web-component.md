# 04-02 — `<agent-avatar>` web component for drop-in embeds

## Why it matters

Third-party hosts (blogs, portfolios, and eventually Lobehub and Claude Artifacts) embed an agent by dropping in a single HTML tag. A proper custom element with an attribute API is the cleanest integration surface — far cleaner than an iframe for interior widgets, and necessary for the host-embed prompts in pillar 05.

## Context

- Library build output: `dist-lib/agent-3d.js` ([vite.config.js](../../vite.config.js) `TARGET=lib`).
- Library entry: [src/lib.js](../../src/lib.js).
- Viewer class: [src/viewer.js](../../src/viewer.js).
- Existing element bootstrap (if any): check `src/element.js`.
- Runtime: [src/runtime/index.js](../../src/runtime/index.js).

## What to build

### `<agent-avatar>` custom element

Registered from [src/lib.js](../../src/lib.js). Tag name: `agent-avatar`.

Attributes:

- `agent-id` — UUID of the agent. When set, the element fetches `/api/agents/:id` from its `origin` attribute (default: `https://3dagent.vercel.app`) and renders.
- `origin` — Override the API origin (for self-hosted deployments).
- `mode` — `"display" | "interactive"`. Default `"display"` (orbit camera, no chat). `"interactive"` enables NichAgent if mounted in a host that supports it.
- `height` — CSS value, default `480px`.
- `background` — CSS color or `"transparent"`.
- `auto-rotate` — boolean; when present, avatar slowly rotates.
- `onchain-id` — optional; when present, bypasses the API and loads from chain (see pillar 06).

Public methods on the element:

- `perform(action)` — emit an action into the element's internal protocol bus.
- `setIdentity(record)` — force-set the identity (for onchain and offline cases).

Events dispatched:

- `agent-ready` — avatar loaded.
- `agent-action` — when the internal protocol emits an action, bubble it out.
- `agent-error` — with `{ error, message }` detail.

### Shadow DOM

All styles and the `<canvas>` live inside a shadow root. Host page CSS cannot reach in. The element exposes CSS custom properties for brand color if needed:

- `--agent-accent`, `--agent-bg`, `--agent-fg`.

### Minimum bundle

Target ≤ 350 KB gzipped. Accept that Three.js + ethers are heavy; keep everything else trim. Use dynamic imports inside the element so a host that only renders avatars (no wallet) doesn't load ethers.

### Demo page

Create `public/embed-test.html` that loads the element directly from `/dist-lib/agent-3d.js` (dev) and shows 3 side-by-side instances with different `agent-id`s. This is not user-facing — it's an internal verification page.

## Out of scope

- Server-rendered thumbnails for SEO (separate concern).
- Voice / chat UI — pillar 05 covers chat embeds.
- Slot content customization.

## Acceptance

1. Drop the following into any HTML page, it works:
   ```html
   <script type="module" src="https://3dagent.vercel.app/agent-3d.js"></script>
   <agent-avatar agent-id="..." height="400px"></agent-avatar>
   ```
2. Changing `agent-id` re-loads the avatar.
3. `agent-ready` event fires with avatar metadata.
4. Gzipped bundle is ≤ 350 KB (report actual).
5. Element works inside a host page that already uses Three.js at a different version (no global clash).
6. `prefers-reduced-motion` disables auto-rotate.
