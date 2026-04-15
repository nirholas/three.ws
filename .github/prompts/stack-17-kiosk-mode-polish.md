---
mode: agent
description: "Kiosk mode polish — minimal chrome, responsive to parent sizing, fast first paint"
---

# Stack Layer 4: Kiosk Mode Polish

## Problem

`?kiosk=1` is the embed-optimized view. Today it likely only hides some chrome. Needs to be rock-solid: minimal UI, fast first paint, responsive to parent iframe sizing, touch-first, no scroll bleed.

## Implementation

### Visible elements in kiosk

- Viewer (full iframe).
- Presence strip (small, corner, semi-transparent).
- Optional: minimal action dock (only if parent passes `?actions=1`).
- Nothing else. No login, no nav, no footer.

### Responsive sizing

- Listen to `resize` and `window.matchMedia`. Viewer re-renders on container resize.
- Use `ResizeObserver` on the canvas parent.
- Respect `devicePixelRatio`, capped at 2 for mobile performance.

### First paint < 2s

- Preload the GLB via `<link rel="preload" as="fetch" crossorigin>` injected after `/api/avatars/by-slug` returns.
- Inline critical CSS (hero background, loading state).
- Defer non-critical JS (analytics, Privy, anything not needed to render the GLB).
- Show a placeholder silhouette while GLB loads.

### Touch

- Single-finger rotate, two-finger pan/zoom (already in OrbitControls but verify on mobile).
- No conflicting page scroll — `touch-action: none` on the canvas.
- `<html>` and `<body>` must be `overflow: hidden` in kiosk.

### Parent-child messaging

Accept `postMessage` from the parent:
- `{ type: 'agent.setSkill', id: 'greet' }` → triggers a skill.
- `{ type: 'agent.setEmotion', blend: { curious: 0.8 } }` → overrides emotional state temporarily.
- `{ type: 'agent.reload' }` → re-fetch and re-render.

Post back to parent:
- `{ type: 'agent.ready', avatarId }` on first render.
- `{ type: 'agent.skillResult', id, result }` on skill completion.

Only accept messages from origins in the referrer allowlist ([prompts/embed/03-embed-allowlist.md](prompts/embed/03-embed-allowlist.md)). Post back via `event.source.postMessage`.

### Theme

`?theme=light|dark|auto` — auto uses `prefers-color-scheme`. Affects presence strip + any chrome, not the 3D scene lighting (that's `?env=...`).

## Validation

- Embed the iframe in a test page with resize handles → smooth resize, no blank frames.
- Lighthouse FCP on mobile < 2s (check with throttled 3G).
- Touch rotate works on iOS Safari without page scroll.
- `postMessage({type:'agent.setSkill',id:'greet'})` from parent → avatar greets.
- Non-allowlisted parent sends postMessage → ignored.
- `npm run build` passes.

## Do not do this

- Do NOT ship login UI into kiosk.
- Do NOT accept postMessage from `*` — always check origin.
