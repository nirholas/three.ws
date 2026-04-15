---
mode: agent
description: "Harden /agent/:id/embed so it renders in third-party iframes under CSP"
---

# 04-03 · Embed iframe reliability

## Why it matters

Pillar 5 (host embed in Claude Artifacts and Lobehub) depends on the embed URL working under strict CSP and in cross-origin iframes. Miss one header and the avatar is a blank rectangle inside Claude.

## Prerequisites

- 02-* complete so an agent can actually be embedded.

## Read these first

- [public/agent/embed.html](../../public/agent/embed.html)
- [vercel.json](../../vercel.json) — current headers block.
- [src/agent-resolver.js](../../src/agent-resolver.js) — resolves `agent-id` on the web component.

## Build this

1. **Response headers** for `/agent/:id/embed`:
   - `X-Frame-Options`: remove (it blocks cross-origin iframes).
   - `Content-Security-Policy`: `frame-ancestors *` (or an allowlist — see 04-04).
   - `Permissions-Policy`: allow `camera=(), microphone=(), clipboard-write=(self)` depending on which widgets are enabled.
2. **Transparent background mode** — query param `?bg=transparent` sets the canvas clear alpha to 0 so the avatar sits on host chrome. `?bg=000000` forces opaque. Default: opaque `#111`.
3. **Kiosk mode** — `?kiosk=1` hides dat.gui, the share panel, and the owner bar. Purely the avatar.
4. **postMessage bridge** — document and implement the minimal contract:
   - Host → iframe: `{ type: 'agent:action', action }` — forwarded to the protocol bus.
   - Iframe → host: `{ type: 'agent:ready' }`, `{ type: 'agent:action', action }` (echo), `{ type: 'agent:resize', height }`.
   - All messages include `agentId` so the host can multiplex.
5. **Resize observer** — post `agent:resize` when the iframe content height changes so hosts can auto-size the iframe.

## Out of scope

- Referrer allowlist (optional; see 04-04 or `prompts/embed/03-embed-allowlist.md`).
- Actual Claude/Lobehub integration (05-*).

## Deliverables

- `vercel.json` header rules for `/agent/:id/embed` and `/api/agent-og`.
- Updates to `public/agent/embed.html` for `bg`, `kiosk`, resize observer.
- A short "bridge contract" comment at the top of `public/agent/embed.html` documenting the messages.

## Acceptance

- Embed loads inside a cross-origin test page (e.g. a CodePen iframe) under default CSP.
- `?bg=transparent&kiosk=1` shows just the avatar on a transparent canvas.
- Host page observes `agent:ready` and `agent:resize` messages.
- `npm run build` passes.
