# Task 02 — iframe ↔ LobeHub `postMessage` handshake

## Context

Repo: `/workspaces/3D`. The file [public/agent/embed.html](../../public/agent/embed.html) is the iframe page LobeHub will load inside a chat message (see [01-plugin-manifest.md](./01-plugin-manifest.md)). Today it already:

- Resolves `agent-id` from the URL path (`/agent/:id/embed`)
- Runs the embed policy check (`/api/agents/:id/embed-policy`)
- Builds a `Viewer` and attaches [AgentAvatar](../../src/agent-avatar.js)
- Listens for `{ __agent, type: 'action', action }` messages and relays them to [agent-protocol](../../src/agent-protocol.js)
- Posts a `{ type: 'ready' }` back to parent on boot

This is a bare bridge. LobeHub needs a richer, versioned protocol: an explicit **init handshake** (so the host can bind the iframe to an agent id it owns), bidirectional action relay, resize events (so the chat message box grows/shrinks with the avatar), and a structured error surface.

This task is the entire `postMessage` layer. It must not regress the existing query-param path (people already embed via `?bg=dark` etc.).

## Goal

Replace the ad-hoc bridge with a versioned, typed, bidirectional protocol between the LobeHub host frame and our embed. Protocol is JSON-over-`postMessage`, namespaced so it coexists with other bridges.

## Deliverable

1. **Protocol module** — new file `src/embed-host-bridge.js`. Pure JS, no runtime deps. Exports a class `EmbedHostBridge` with:
   - Constructor: `new EmbedHostBridge({ protocol, identity, viewer, avatarCtl, agentId })`
   - `attach()` — starts listening for host messages, posts `hello`
   - `detach()` — removes listeners
   - `postToHost(type, payload)` — envelope helper
   - Internal event vocabulary below
2. **Edit embed page** — [public/agent/embed.html](../../public/agent/embed.html) imports the bridge and replaces the inline `window.addEventListener('message', ...)` block. The existing `ready`/`blocked` posts should be routed through the bridge.
3. **Version** — first line of every envelope: `{ v: 1, ns: '3d-agent', ... }`. Reject unknown `v`.

## Event vocabulary

All messages are JSON objects. Outbound (embed → host) and inbound (host → embed) share the envelope `{ v: 1, ns: '3d-agent', type, id?, payload }`. Replies echo the inbound `id`.

### Inbound (host → embed)

| type | payload | effect |
|---|---|---|
| `host:hello` | `{ hostName, hostVersion, capabilities: string[] }` | Handshake. Embed replies with `embed:hello` including its capability list. |
| `host:set-agent` | `{ agentId }` | Rebind to a different agent id. Tear down current avatar, resolve new one, boot. |
| `host:action` | `{ action: { type, payload, sourceSkill? } }` | Emit on `protocol`. Covered in full in [04-action-passthrough.md](./04-action-passthrough.md); for this task, keep the existing relay wrapped in the new envelope. |
| `host:pause` | `{}` | Call `viewer.pause?.()` or stop RAF. |
| `host:resume` | `{}` | Resume viewer. |
| `host:theme` | `{ mode: 'dark' \| 'light' \| 'transparent', accent? }` | Apply background + accent without reload. |
| `host:ping` | `{}` | Reply with `embed:pong`. Used by host to detect stale iframes. |

### Outbound (embed → host)

| type | payload | when |
|---|---|---|
| `embed:hello` | `{ embedVersion, agentId, capabilities }` | On `host:hello` or first post after DOM ready |
| `embed:ready` | `{ agentId, name, avatarUrl }` | Avatar GLB loaded, `AgentAvatar` attached |
| `embed:blocked` | `{ reason: 'policy' }` | Embed-policy check failed |
| `embed:error` | `{ code, message, phase }` | Any boot or runtime error (phases: `policy`, `identity`, `avatar`, `viewer`, `bridge`) |
| `embed:action` | `{ action: { type, payload, sourceSkill, timestamp, agentId } }` | Mirrors every `protocol` event outward so the host can log what the avatar did. Filter to protocol's `ACTION_TYPES` only. |
| `embed:resize` | `{ width, height, contentHeight }` | When the viewer reports a new content height (e.g. name plate grew, error shown) |
| `embed:pong` | `{}` | Reply to `host:ping` |

## Audit checklist

- **Origin discipline.** Reject inbound messages whose `event.origin` is not one of: same-origin, the origin passed via `?host=<encoded-origin>` URL param, or (if unset) any origin but with a console warn flag. **Never** trust `event.data` blindly.
- **Envelope validation.** Drop any message without `v === 1`, missing `ns === '3d-agent'`, or missing `type`. Do not throw — just return.
- **Id correlation.** If inbound carries an `id`, the reply must echo it.
- **No duplicate listeners.** If `attach()` is called twice, the second call must be a no-op or cleanly replace.
- **Teardown.** `detach()` must remove every `window.addEventListener('message', ...)` registered, cancel any pending `resize` `ResizeObserver`, and null internal refs.
- **ResizeObserver** on the stage element feeds `embed:resize`. Debounce to ~100ms so a drag doesn't flood the host.
- **Action filter.** `embed:action` must not mirror `host:action` back out — that would create a loop. Tag host-originated emits with `sourceSkill: 'host'` (or a marker) and filter.
- **Backward compat.** The legacy `{ __agent: agentId, type: 'action', action }` format used by existing embedders must continue to work for at least one version. Accept both; deprecate-log the legacy form.
- **Preserve Empathy Layer.** Every `host:action` with `type: 'speak'` must still hit [agent-protocol](../../src/agent-protocol.js) so emotion blending runs. Do not shortcut to `viewer.speak()` or similar.

## Constraints

- No new runtime deps.
- Pure ES module, importable by the embed page via `<script type="module">`.
- All console logs tagged `[3d-agent:bridge]` for filter-ability.
- If a LobeHub-specific field differs from the spec here (e.g. LobeHub posts `{type: 'tool_call'}` not wrapped in our envelope), flag it with `// TODO(lobehub-spec): confirm` — **do not** auto-adapt by guessing.

## Verification

1. `node --check src/embed-host-bridge.js public/agent/embed.html` (embed.html won't parse as JS, but run `node --check` on the bridge module).
2. `npx vite build` succeeds.
3. Manual — open `public/agent/:id/embed?preview=1` at top-level. In devtools, confirm no host-bridge errors fire when there is no parent (the embed should still work standalone).
4. Write a tiny ad-hoc `test-host.html` (do **not** commit it) that iframes `/agent/:id/embed` and posts each inbound message type. Observe replies. Take a screenshot for the report.
5. Confirm `embed:action` mirrors every `speak`/`gesture`/`emote` etc. in the parent's message log.
6. Trigger a fake policy block and confirm `embed:blocked` fires with correct envelope.

## Scope boundaries — do NOT do these

- Do **not** implement host-auth/SIWE. That is [03](./03-host-auth-handoff.md).
- Do **not** add tool-call semantics. That is [04](./04-action-passthrough.md). The handshake carries raw `action` objects; meaning-mapping lives elsewhere.
- Do **not** touch the plugin manifest. That is [01](./01-plugin-manifest.md).
- Do **not** refactor [src/element.js](../../src/element.js) — the web component has its own surface.
- Do **not** change the embed-policy flow in `checkPolicy()`.

## Files off-limits

- `public/.well-known/lobehub-plugin.json` — owned by [01](./01-plugin-manifest.md)
- `api/agents/[id]/embed-policy.js` — settled, do not touch

## Reporting

- New file `src/embed-host-bridge.js` — line count, exported symbols
- Edits to `public/agent/embed.html` — which block was replaced, line count delta
- All `TODO(lobehub-spec)` flags, enumerated verbatim
- `node --check` + `vite build` results
- Manual handshake-test screenshot or console log dump
- Whether backward compat with legacy `{ __agent, type: 'action' }` is preserved (yes/no + how verified)
- Any unrelated bugs noticed in `embed.html` — note, don't fix
