# three.ws — LobeHub Plugin

Embeds a rigged 3D avatar agent into any LobeHub instance via the plugin manifest + iframe bridge.

## Install into a LobeHub fork

1. Open your LobeHub instance → Settings → Plugins → Custom Plugin.
2. Enter the manifest URL: `https://three.ws/api/lobehub/manifest`
3. Install. LobeHub fetches the manifest, registers the four tools (`render_agent`, `speak`, `gesture`, `emote`), and renders the iframe at `/lobehub/iframe/` inside chat messages.
4. Optionally pre-validate an agent before rendering: `POST /api/lobehub/handshake` with `{ agentId, hostOrigin }`.

## postMessage contract

All messages share the envelope:

```json
{ "v": 1, "ns": "3d-agent", "type": "<string>", "id": "<optional>", "payload": {} }
```

### Host → embed (inbound)

| type             | payload                                             | effect                        |
| ---------------- | --------------------------------------------------- | ----------------------------- |
| `host:hello`     | `{ hostName, hostVersion, capabilities }`           | Triggers `embed:hello` reply  |
| `host:ping`      | `{}`                                                | Triggers `embed:pong` reply   |
| `host:action`    | `{ action: { type, payload } }`                     | Dispatches to avatar          |
| `host:pause`     | `{}`                                                | Pauses the viewer             |
| `host:resume`    | `{}`                                                | Resumes the viewer            |
| `host:theme`     | `{ mode: 'dark'\|'light'\|'transparent', accent? }` | Sets background + accent      |
| `host:set-agent` | `{ agentId }`                                       | Reloads iframe with new agent |

Accepted action types for `host:action.action.type`: `speak`, `gesture`, `emote`.

### Embed → host (outbound)

| type            | payload                                             | when                                |
| --------------- | --------------------------------------------------- | ----------------------------------- |
| `embed:hello`   | `{ embedVersion, agentId, capabilities }`           | On load and on `host:hello`         |
| `embed:ready`   | `{ agentId, name, avatarUrl }`                      | Avatar fully loaded                 |
| `embed:blocked` | `{ reason }`                                        | Embed-policy check failed           |
| `embed:error`   | `{ code, message, phase }`                          | Boot or runtime error               |
| `embed:action`  | `{ action: { type, payload, timestamp, agentId } }` | Mirrors every dispatched action     |
| `embed:resize`  | `{ width, height, contentHeight }`                  | On element resize (debounced 100ms) |
| `embed:pong`    | `{}`                                                | Reply to `host:ping`                |

### Origin rules

- `chat.lobehub.com` and `lobechat.ai` are trusted unconditionally.
- Pass `?host=<encoded-origin>` to narrow trust to a single parent origin.
- `localhost` / `127.0.0.1` / `.local` are trusted in development (logged, not blocked).
- Unknown origins are permitted but logged — public agents may embed anywhere.

### Legacy compat

The format `{ __agent: <id>, type: 'action', action }` from existing embedders is accepted for one version. Migrate to the v1 envelope.

## Acceptance-test handshake

For quick integration testing, posting `{ type: 'handshake' }` from any origin returns `{ type: 'ready', agentId }` without envelope wrapping. This is NOT the production protocol.

## What this plugin does NOT yet support

- **Host-auth / SIWE** — embedding a user-auth token so the iframe can call authed APIs on behalf of the LobeHub user (spec: `prompts/lobehub-embed/03-host-auth-handoff.md`).
- **Tool-call relay** — structured LobeHub `tool_call` → action mapping; today the relay passes raw action objects (spec: `prompts/lobehub-embed/04-action-passthrough.md`).
- **LobeHub marketplace submission** — the manifest is hosted in this repo; no registry entry exists yet (spec: `prompts/lobehub-embed/05-plugin-submission.md`).
- **MCP tool semantics** — the `api` entries point at `/api/mcp` but the `tool` dispatch mapping from LobeHub's tool-call format to MCP JSON-RPC is not wired.
- **Emote public API** — `host:action` with `type: emote` dispatches a `CustomEvent` on the element but `<agent-3d>` has no public `emote()` method; internal routing depends on element.js wiring.

## Related specs

- `prompts/lobehub-embed/01-plugin-manifest.md` — manifest design
- `prompts/lobehub-embed/02-iframe-handshake.md` — full postMessage protocol
- `prompts/lobehub-embed/03-host-auth-handoff.md` — auth handoff (not yet implemented)
- `prompts/lobehub-embed/04-action-passthrough.md` — tool relay (not yet implemented)
