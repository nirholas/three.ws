# Task 01 — Share panel on the agent page

## Why this exists

Owners land on `/agent/:slug` and want one obvious "share" action. Right now embed URLs and snippets live in hidden corners or require copy-paste gymnastics. One panel, four paths: public URL, iframe snippet, JS web-component snippet, OG preview.

## Files you own

- Edit: `public/agent/index.html` — add a share button in the top nav / header.
- Create: `src/agent-page/share-panel.js` — panel module, lazy-loaded on button click.
- Create: `src/agent-page/share-panel.css` (or append to `style.css`).
- Do not modify the embed page itself.

## Deliverable

### Share button

Primary affordance placed next to any existing "edit" / "preview" control. Label `🔗 Share`. Click toggles the panel.

### Panel contents

1. **Public URL** — a copy-to-clipboard input prefilled with the canonical URL.
2. **Iframe snippet** — one-line iframe with sensible defaults, copy button.
3. **Web-component snippet** — `<script>` + `<agent-3d id="…">` pair (only shown if the `<agent-3d>` element is shipping; otherwise hide).
4. **OG preview card** — rendered mock of what the link looks like when pasted into Slack / Discord / iMessage. Pull the image from the existing OG endpoint (`api/agent-og.js` if present).
5. **QR code** — a small data-URL QR linking to the public URL, generated client-side with a tiny helper (no new dep — write 80 lines of JS or skip QR and document the skip).

### Accessibility

- Panel is focus-trapped while open.
- Copy buttons announce "Copied ✓" via an aria-live region.
- Escape closes the panel.

## Constraints

- No new dep (no react-share, no qrcode). Write what you need inline.
- Panel opens from an existing route; do not introduce a new URL.
- The iframe snippet must include `allow="xr-spatial-tracking; camera; microphone"` (for WebXR) and `loading="lazy"` — record why each attribute is there in a code comment.

## Acceptance test

1. `node --check src/agent-page/share-panel.js` passes.
2. Click Share → panel opens, focus moves to first control.
3. Click each Copy button → clipboard contains the expected text (test with `document.execCommand('paste')` in DevTools or manual paste).
4. Pasting the iframe snippet into a blank HTML file and opening it → avatar renders.
5. Close with Escape and with the backdrop click.

## Reporting

- Whether you included QR and how it was generated.
- Any browsers where `navigator.clipboard.writeText` was blocked.
