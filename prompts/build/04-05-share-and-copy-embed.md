# 04-05 — Share sheet and copy-embed UI

## Why it matters

Host embeds (Layer 5) only help if users actually paste the embed snippet somewhere. The agent page needs a first-class share affordance that gives them the URL, the iframe snippet, and the `<agent-3d>` web component snippet, with one-click copy for each. Without it, we rely on users to hand-assemble HTML — they won't.

## Context

- Public agent page: [public/agent/index.html](../../public/agent/index.html), [public/agent/embed.html](../../public/agent/embed.html).
- Web-component entry (per 04-02): `dist-lib/agent-3d.js`.
- oEmbed + OG already handled in 04-02 / 04-04 / 02-05.

## What to build

### Share panel component

On the public agent page, a new panel labeled "Share this agent" with three tabs:

1. **Link** — `https://3dagent.vercel.app/a/:id` with copy button.
2. **iframe** — `<iframe src="https://3dagent.vercel.app/a/:id/embed" width="480" height="540" style="border:0" allow="xr-spatial-tracking; fullscreen"></iframe>` with copy button.
3. **Web component** — `<script type="module" src="https://3dagent.vercel.app/lib/agent-3d.js"></script>\n<agent-3d agent="<id>"></agent-3d>` with copy button.

Each tab shows a live preview of what the embed will look like (for web component and iframe). All three are read-only `<textarea>` or `<pre>` with a copy button that confirms with a 1s "Copied" pill.

### Native share (mobile)

If `navigator.share` is available, a top-level "Share…" button invokes it with `{ title, text, url }`. Otherwise hide the button. Do not fall back to a share modal — the three tabs cover desktop.

### Referrer guardrail

The iframe snippet embeds with `referrerpolicy="strict-origin-when-cross-origin"`. Document (as a one-line comment in the snippet) that paid plans can restrict referrers — link to the embed-policy UI.

### No JS framework, no deps

Use vanilla DOM. Match the existing dashboard styling tokens. Copy-to-clipboard via `navigator.clipboard.writeText`, with a `document.execCommand('copy')` fallback on older browsers.

## Out of scope

- QR code generation.
- Tracking share clicks.
- Email / SMS / platform-specific share buttons beyond `navigator.share`.
- A dedicated "embed wizard" UI — three tabs is enough.

## Acceptance

1. Open `/a/:id` on desktop → share panel visible with all three tabs; copying each confirms.
2. Open on iPhone Safari → "Share…" button invokes the native sheet.
3. Paste the iframe snippet into a blank HTML file → avatar renders.
4. Paste the web-component snippet into a blank HTML file with a 2-line script → avatar renders.
5. No regression on the existing agent page layout at widths ≥ 360px.
6. `node --check` passes on any modified JS.
