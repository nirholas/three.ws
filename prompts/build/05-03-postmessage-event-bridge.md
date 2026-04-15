# 05-03 — Host embed: postMessage event bridge

**Branch:** `feat/host-bridge`
**Stack layer:** 5 (Host embed)
**Depends on:** 05-01
**Blocks:** 05-04, 05-08

## Why it matters

Hosts (Claude Artifacts, Lobehub, ChatGPT canvas, generic iframes) need a uniform way to talk to the embedded agent. Today every host integration would write its own bridge. A single, documented `host:*` postMessage protocol means we ship one bridge and route every host through it.

## Read these first

| File | Why |
|:---|:---|
| [src/element.js](../../src/element.js) | Mount point for the bridge. |
| [src/agent-protocol.js](../../src/agent-protocol.js) | Bus that bridges messages dispatch into. |
| [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md) | Embed spec — append the host-message protocol section here. |
| [src/agent-skills.js](../../src/agent-skills.js) | Skill execution — what `host:perform-skill` calls. |

## Build this

1. Add `src/host-bridge.js` — small ESM module exporting `mountHostBridge(element, protocol)`. Listens to `window.message`, validates origin against `element.dataset.allowOrigins` (CSV) or a sane default (Claude, Lobehub, same-origin).
2. Define and document the protocol (extend [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md)):

   **Inbound (host → agent):**
   - `host:hello` `{ host, version }` → reply `agent:ready { agentId, capabilities, version }`
   - `host:set-context` `{ agentId?, theme?, locale? }` → swap context live
   - `host:perform-skill` `{ skill, args, callId }` → reply `agent:skill-result { callId, ok, result|error }`
   - `host:say` `{ text }` → triggers `speak` action on bus
   - `host:resize` `{ width, height }` → element adopts dimensions

   **Outbound (agent → host):**
   - `agent:ready` (boot complete)
   - `agent:action` `{ type, payload }` (mirror of every protocol bus event)
   - `agent:request-resize` `{ height }` (when content height changes)
   - `agent:request-auth` (when user clicks something requiring SIWE)

3. Wire `mountHostBridge` from `<agent-3d>` connected callback. Tear down on disconnect.
4. Add a `data-host-debug="1"` attribute that logs every inbound + outbound message to console (off by default).

## Out of scope

- Do not add JSON-RPC framing — flat `{ type, ... }` is enough.
- Do not implement encryption between host and agent.
- Do not require host to register before sending — origin check is the gate.
- Do not add a request/response queue with retries; replies are best-effort.

## Acceptance

- [ ] `mountHostBridge` is unit-testable as a pure function (export accepts a fake `EventTarget`).
- [ ] Spec section in [specs/EMBED_SPEC.md](../../specs/EMBED_SPEC.md) lists every message type with shape + example.
- [ ] Origin-mismatched messages are silently dropped (no console spam).
- [ ] `npm run build` passes.

## Test plan

1. Open a scratch HTML page on `localhost` that hosts an iframe of `/agent/<id>/embed`.
2. Send each `host:*` message from the parent and verify the reply / behavior.
3. Verify `agent:action` events fire on every bus event (subscribe in the parent and log).
4. Try posting from a non-allowed origin (use a different port) → no reply, no crash.
