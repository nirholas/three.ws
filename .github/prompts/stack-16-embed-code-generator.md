---
mode: agent
description: "Embed code generator — copy-paste snippets for iframe, web component, React"
---

# Stack Layer 4: Embed Code Generator

## Problem

For the agent to appear in third-party sites, the owner needs one-click copy-paste embed snippets. Today no generator UI exists. Must produce iframe, web-component, and React snippets from a single settings form.

## Implementation

### Page

`/embed/:slug` — dedicated page, linked from the agent public page's share CTA.

### Settings form

- **Size** — preset (400×600, 600×600, full-width responsive) or custom W×H.
- **Mode** — `presence` (full interactive), `kiosk` (no UI), `snapshot` (static image).
- **Theme** — light, dark, auto.
- **Actions visible** — checkboxes for which skills appear in the action dock.
- **Auto-rotate** — on/off.
- **Background** — transparent, solid color picker, environment preset.

### Generated snippets

Live-update three snippets in tabs as settings change:

**iframe**:
```html
<iframe src="https://3dagent.vercel.app/agent/satoshi?kiosk=1&theme=dark"
        width="600" height="600" style="border:0"
        allow="camera; microphone; xr-spatial-tracking"></iframe>
```

**Web component** (using [src/element.js](src/element.js)):
```html
<script src="https://3dagent.vercel.app/dist-lib/agent-3d.js"></script>
<agent-3d slug="satoshi" theme="dark" mode="kiosk"></agent-3d>
```

**React** (thin wrapper note — the lib is framework-agnostic):
```jsx
<iframe src="https://3dagent.vercel.app/agent/satoshi?kiosk=1" width={600} height={600} />
```

### Copy button

Each snippet has a "Copy" button. Track copy events (`embed.copied` telemetry) so we can see adoption.

### Live preview

Right side of the page renders the actual embedded agent with the chosen settings, reflecting changes in real time.

### Referrer allowlist link

"Restrict which sites can embed this agent" link → takes owner to [prompts/embed/03-embed-allowlist.md](prompts/embed/03-embed-allowlist.md) settings (already specced).

## Validation

- Change size → live preview resizes, snippet updates.
- Copy each of the three snippets → paste into a test HTML file → all three render the agent.
- Transparent background + solid page color → agent floats on page.
- Web component snippet works offline if `dist-lib/agent-3d.js` is served (not 404).
- `npm run build` passes.

## Do not do this

- Do NOT generate server-side React components. Reference the iframe/web-component path.
- Do NOT hardcode the domain — read from `window.location.origin` so preview works on localhost.
