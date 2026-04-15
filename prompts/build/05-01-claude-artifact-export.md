# 05-01 — "Embed in Claude Artifacts" — one-click artifact export

**Branch:** `feat/claude-artifact-export`
**Stack layer:** 5 (Host embed — Claude)
**Depends on:** 04-01 (OG image), 04-02 (embed policy), 04-03 (redacted public fetch)
**Blocks:** 06-* (onchain resolution wants a concrete host integration to validate against)

## Why it matters

Claude Artifacts are self-contained HTML documents. A user pastes the artifact into a Claude chat and the agent appears *embodied in the conversation* — exactly the novel unlock in the priority stack. This prompt produces the artifact HTML on demand, scoped to a single agent.

## Read these first

| File | Why |
|:---|:---|
| [src/element.js](../../src/element.js) | `<agent-3d>` web component — the minimal embed surface. |
| [agent-embed.html](../../agent-embed.html) | Current iframe shell; structurally close to what the artifact will contain. |
| [api/agents.js](../../api/agents.js), the public `toPublicAgent` helper from 04-03 | The data that goes into the artifact. |
| Claude Artifacts docs — assume: single HTML file, external resources allowed, sandboxed iframe context. |

## Build this

### Endpoint — `GET /api/agents/:id/artifact.html`

- **Auth:** public; rate-limited.
- **Output:** a single, self-contained HTML document (content-type `text/html; charset=utf-8`) that:
  1. Loads the built web-component bundle from the production origin (`<script type="module" src="https://3dagent.vercel.app/dist-lib/agent-3d.js">`).
  2. Renders `<agent-3d agent-id="<id>" host="claude"></agent-3d>`.
  3. Sets a viewport meta tag, a dark background, and sane mobile defaults.
  4. Includes Open Graph meta tags (reusing the 04-01 OG image) so previews of the artifact render correctly outside Claude too.

The goal: drop-in paste into Claude Artifacts, shows the agent.

### Dashboard UI

On the agent home / dashboard, add a **"Embed in Claude"** button. Clicking it:
- Generates a copy-to-clipboard snippet containing the artifact HTML (inlined — not a URL).
- Also offers a short-lived signed URL (`/api/agents/:id/artifact.html?token=...`) for users who prefer linking.

### `host=claude` behaviour

The web component reads its `host` attribute. When `host=claude`:
- Disable any hover-only UI (Claude artifacts may sandbox pointer events).
- Default to `kiosk=true` (no dat.gui, no header).
- Cap the canvas devicePixelRatio at 2 to keep perf bounded inside Claude.
- Post a `window.parent.postMessage({ type: 'agent:ready', id })` so Claude-side listeners (if any) can react.

### Library build

[dist-lib/](../../dist-lib/) must contain a single `agent-3d.js` ESM bundle. If `npm run build:lib` doesn't already produce this, update the Vite lib config.

## Out of scope

- Do not implement chat-proxy for the agent talking back inside Claude — separate prompt, needs MCP wiring.
- Do not write a Claude-side skill/extension.
- Do not add analytics to the artifact.

## Acceptance

- [ ] `curl /api/agents/<id>/artifact.html` returns a valid HTML document that renders the agent in a fresh Chrome tab offline-from-dashboard.
- [ ] Pasting the artifact into a Claude chat shows the 3D avatar.
- [ ] The copy button on the dashboard yields ready-to-paste HTML.
- [ ] The web component builds cleanly via `npm run build:lib` and the resulting bundle is under 500 KB gzipped.
- [ ] `host=claude` disables the dat.gui + header.
