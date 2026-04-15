---
mode: agent
description: "Freeze the host↔agent postMessage bridge as a versioned contract + tiny JS SDK"
---

# 05-04 · Host ↔ agent postMessage bridge

## Why it matters

Third-party hosts (Lobehub fork, Claude Artifacts, future embedders) only work reliably if the postMessage contract between host and iframe is documented, versioned, and stable. Without this, every host integration drifts.

## Prerequisites

- 04-03 (embed reliability) shipped.

## Read these first

- [public/agent/embed.html](../../public/agent/embed.html) — where the bridge is implemented.
- [src/agent-protocol.js](../../src/agent-protocol.js) — event bus the bridge forwards into.

## Build this

1. **Document the contract** at the top of `public/agent/embed.html` as a comment block:
   ```
   Bridge v1
   Host → iframe:
     { type: 'agent:action', agentId, action }      // forward action to protocol bus
     { type: 'agent:hello',  agentId, host }         // handshake; iframe replies with agent:ready
     { type: 'agent:ping',   id }                    // liveness; replies agent:pong
   Iframe → host:
     { type: 'agent:ready',  agentId, version, capabilities: [...] }
     { type: 'agent:action', agentId, action }       // echo of actions emitted
     { type: 'agent:resize', agentId, height }
     { type: 'agent:pong',   id }
   All messages include `agentId`. Unknown `type` values are ignored.
   ```
2. **Implement** matching handlers in `public/agent/embed.html` if any are missing.
3. **Add a tiny JS SDK** `public/embed-sdk.js` (≤ 100 lines) that a host developer can `<script src="...">` and use:
   ```js
   const bridge = Agent3D.connect(iframeEl, { agentId, onAction, onReady, onResize });
   bridge.send({ type: 'present-model', url: '...' });
   ```
   - Two-way message routing.
   - Auto-resize the iframe to reported height.
   - Timeout on hello → fallback behavior.
4. **Link from Share panel** — add a "Custom embed" tab that shows the bridge docs and links to `embed-sdk.js`.

## Out of scope

- Bidirectional audio / video streams over the bridge.
- Encrypted messaging.
- Version 2 of the bridge. This is v1; freeze it.

## Deliverables

- Comment block at top of `public/agent/embed.html`.
- `public/embed-sdk.js` (new).
- Share panel "Custom embed" tab.

## Acceptance

- Host page using `Agent3D.connect(...)` receives `agent:ready` within 2s.
- Actions sent from host appear on iframe's protocol bus.
- `npm run build` passes.
