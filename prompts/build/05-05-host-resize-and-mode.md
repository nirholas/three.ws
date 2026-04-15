# 05-05 — Host embed: resize and display mode protocol

**Branch:** `feat/host-resize-mode`
**Stack layer:** 5 (Host embed)
**Depends on:** 05-03 (postMessage bridge)

## Why it matters

The agent needs to fit the host's layout — sometimes inline (300px), sometimes floating (avatar bubble in the corner), sometimes fullscreen (presentation mode). Today these modes are set once at boot via the `mode` attribute. Hosts need to flip them live as the user resizes their chat panel or maximizes the artifact.

## Read these first

| File | Why |
|:---|:---|
| [src/element.js](../../src/element.js) | Existing `mode` attribute (inline | floating | section | fullscreen). |
| [src/host-bridge.js](../../src/host-bridge.js) | Bridge to extend (created in 05-03). |
| [src/viewer.js](../../src/viewer.js) | `resize()` method or equivalent — the canvas needs to react. |
| [style.css](../../style.css) | Mode-specific CSS classes. |

## Build this

1. Extend the bridge inbound protocol with `host:set-mode { mode }` — accepted values: `inline | floating | section | fullscreen`.
2. On mode change:
   - Update `data-mode` on the embed root.
   - Call `viewer.resize()` after the next animation frame.
   - In `floating` mode, position absolute bottom-right with a 16px margin and a max-size of 240×240.
   - In `fullscreen` mode, fix to viewport, hide all chrome.
3. Add `agent:request-resize { width, height }` outbound — emit when the avatar's natural display height changes (e.g. caption text wraps to a new line).
4. Listen to `ResizeObserver` on the host iframe element (when `data-host-bridge-track="1"`) and call `viewer.resize()` automatically.
5. Honor `prefers-reduced-motion` — disable the floating-mode entrance bounce.

## Out of scope

- Do not implement drag-to-reposition for floating mode (later).
- Do not add a settings panel for picker modes.
- Do not touch the dat.gui visibility logic — that's controlled by `kiosk` separately.

## Acceptance

- [ ] `host:set-mode` flips modes live with no remount.
- [ ] Canvas resizes correctly without distortion or blur.
- [ ] `agent:request-resize` fires when caption text wraps.
- [ ] Floating mode positions bottom-right, fullscreen covers viewport.
- [ ] `npm run build` passes.

## Test plan

1. Boot a scratch host page with the embed in `inline` mode.
2. Send `host:set-mode { mode: 'floating' }` — verify position and size.
3. Resize the host iframe — verify the canvas tracks.
4. Send `host:set-mode { mode: 'fullscreen' }` — verify viewport coverage.
5. Toggle `prefers-reduced-motion` — confirm no entrance animation.
