# 11 — Share panel module

## Why

Users need a one-click way to get copy-paste snippets for any agent: short link, iframe, `<agent-3d>` web-component, OG-preview thumbnail. Currently scattered across dashboards and not surfaced on the public agent page.

## Parallel-safety

Self-contained module. No app wiring. No edits to `src/app.js` or any agent page.

## Files you own

- Create: `src/share-panel.js`
- Create: `src/share-panel.css`

## Deliverable

```js
export class SharePanel {
    constructor({ agent, container, embedOrigin = location.origin })
    // agent: { id, slug, name, thumbnailUrl }
    open()
    close()
}
```

Renders a modal with these rows:

1. **Link** — `https://${embedOrigin}/a/${agent.slug || agent.id}` + Copy + Open-in-new-tab buttons
2. **iframe snippet**:
    ```html
    <iframe
    	src="${embedOrigin}/agent-embed.html?id=${agent.id}"
    	width="480"
    	height="640"
    	frameborder="0"
    	allow="microphone; camera"
    ></iframe>
    ```
3. **Web-component snippet**:
    ```html
    <script type="module" src="${embedOrigin}/dist-lib/agent-3d.js"></script>
    <agent-three.ws-id="${agent.id}"></agent-3d>
    ```
4. **OG preview** — render an `<img src="${embedOrigin}/api/a-og?id=${agent.id}">` at 1200×630 scaled down, with copy-OG-URL button.
5. **QR code** — generate client-side (see constraint) pointing to the Link row.

Each copy button: flash "copied ✓" for 1.2s.
`Esc` closes. Click outside `.share-panel-modal` closes. Focus trap.

## Constraints

- No new runtime deps. For QR: use a tiny inline `qr-generator` — if [src/erc8004/qr.js](../../src/erc8004/qr.js) exists and exports a helper, reuse it; otherwise render a placeholder `<div>` labeled "QR coming soon" and note it in the report. Do NOT install a QR package.
- Dark-theme default. Scoped CSS (`.share-panel-*`).
- ARIA: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`.

## Acceptance

- `node --check src/share-panel.js` passes.
- `npm run build` clean.
- Scratch-mount with a fake agent object: modal opens, all copy buttons work, Esc closes, focus returns to opener.

## Report

- QR decision (reused helper vs stub).
- Accessibility smoke (keyboard-only walkthrough).
