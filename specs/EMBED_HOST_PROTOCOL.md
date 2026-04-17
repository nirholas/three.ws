# EMBED_HOST_PROTOCOL — v1

Versioned postMessage bus between a host page (Claude.ai, LobeHub, blog) and an embedded 3D Agent iframe.

---

## Envelope

Every message is a JSON object:

```json
{ "v": 1, "type": "<direction>.<category>", "id": "<optional>", "payload": { ... } }
```

| Field | Required | Description |
|---|---|---|
| `v` | yes | Protocol version integer. Current: `1`. |
| `type` | yes | Dot-namespaced string. `host.*` or `embed.*`. |
| `id` | request/response only | Correlation token for request–response pairs. |
| `payload` | conditional | Type-specific data object. |

Messages missing `v: 1` or `type` are malformed and MUST be ignored by the receiver (embed sends one `embed.error` diagnostic; host should log and discard).

---

## Host → Embed messages

### `host.hello`

Sent once after the iframe load event. Initiates the handshake.

```json
{
  "v": 1,
  "type": "host.hello",
  "payload": {
    "hostName": "claude.ai",
    "hostVersion": "2024-11",
    "hostOrigin": "https://claude.ai",
    "userId": "u_abc123",
    "userName": "Alice"
  }
}
```

| Field | Required | Type |
|---|---|---|
| `hostName` | yes | string |
| `hostVersion` | yes | string |
| `hostOrigin` | yes | string (origin URL) |
| `userId` | no | string |
| `userName` | no | string |

---

### `host.chat.message`

Delivers a chat turn into the agent.

```json
{
  "v": 1,
  "type": "host.chat.message",
  "payload": {
    "role": "user",
    "text": "Hello, tell me about yourself.",
    "messageId": "msg_001"
  }
}
```

| Field | Required | Type |
|---|---|---|
| `role` | yes | `"user"` \| `"assistant"` |
| `text` | yes | string |
| `messageId` | yes | string (unique per message) |

---

### `host.action`

Triggers a named action on the agent (emotes, speech, etc.).

```json
{
  "v": 1,
  "type": "host.action",
  "payload": {
    "action": "emote.wave",
    "args": {}
  }
}
```

```json
{
  "v": 1,
  "type": "host.action",
  "payload": {
    "action": "speak",
    "args": { "text": "Welcome back!" }
  }
}
```

| Field | Required | Type |
|---|---|---|
| `action` | yes | string |
| `args` | no | object |

---

### `host.theme`

Updates the embed's visual theme.

```json
{
  "v": 1,
  "type": "host.theme",
  "payload": {
    "mode": "dark"
  }
}
```

| Field | Required | Type |
|---|---|---|
| `mode` | yes | `"dark"` \| `"light"` |

---

### `host.response`

Reply to an `embed.request`. Identified by matching `id`.

```json
{
  "v": 1,
  "type": "host.response",
  "id": "<same id as embed.request>",
  "payload": {
    "result": { ... }
  }
}
```

On error:

```json
{
  "v": 1,
  "type": "host.response",
  "id": "<same id>",
  "payload": {
    "error": { "code": "NOT_FOUND", "message": "resource not found" }
  }
}
```

---

## Embed → Host messages

### `embed.ready`

Sent by the embed after `start()` to announce the agent is live.

```json
{
  "v": 1,
  "type": "embed.ready",
  "payload": {
    "agentId": "agent_xyz",
    "version": "1.0.0",
    "capabilities": ["chat", "emote", "speak"]
  }
}
```

| Field | Required | Type |
|---|---|---|
| `agentId` | yes | string |
| `version` | yes | semver string |
| `capabilities` | yes | string[] |

---

### `embed.event`

Generic agent lifecycle or interaction event stream.

```json
{
  "v": 1,
  "type": "embed.event",
  "payload": {
    "event": "agent.speaking",
    "data": { "text": "Hello!" }
  }
}
```

| Field | Required | Type |
|---|---|---|
| `event` | yes | string |
| `data` | no | object |

Common event names: `agent.speaking`, `agent.idle`, `agent.emote`, `agent.error`.

---

### `embed.error`

Reports a protocol-level error to the host (malformed message received, unsupported action, etc.).

```json
{
  "v": 1,
  "type": "embed.error",
  "payload": {
    "code": "MALFORMED_MESSAGE",
    "message": "missing v:1 or type"
  }
}
```

| Field | Required | Type |
|---|---|---|
| `code` | yes | UPPER_SNAKE string |
| `message` | yes | string |

---

### `embed.request`

Ask the host for data or an action. Host replies with `host.response` matching `id`.

```json
{
  "v": 1,
  "type": "embed.request",
  "id": "req_abc",
  "payload": {
    "method": "host.getUser",
    "params": {}
  }
}
```

| Field | Required | Type |
|---|---|---|
| `id` | yes | string (unique per request) |
| `payload.method` | yes | string |
| `payload.params` | no | object |

Default timeout: 5 000 ms. After timeout the pending request rejects with a timeout error.

---

## Handshake sequence

```
Host                          Embed
 |                              |
 | <-- iframe loads             |
 |                              | start() called
 |                              | send('embed.ready', { ... })
 | --> host.hello               |
 | dispatchEvent('host.hello')  |
 |                              |
 | --> host.chat.message        |
 | dispatchEvent(...)           |
```

The embed sends `embed.ready` immediately on `start()`. The host may send `host.hello` at any time; the embed re-emits it as a `CustomEvent` named `host.hello`.

---

## Origin allowlist

`EmbedHostBridge` accepts an `allowedOrigins` constructor option:

| Value | Behaviour |
|---|---|
| `'*'` (default) | Accept messages from any `window.parent` origin. |
| `string[]` | Accept only listed origins (exact match). Example: `['https://claude.ai', 'https://lobehub.com']`. |

Messages from non-parent frames are always rejected regardless of allowlist.

---

## Versioning policy

- `v` is an integer incremented on **breaking changes** (field renames, removed types, changed semantics).
- New optional fields and new message types are **non-breaking** — do not bump `v`.
- Deprecated types MUST be supported for one full minor version before removal.
- Receivers MUST silently ignore unknown types (log once; do not crash; do not send `embed.error` for unknown types from a higher version).

---

## Security notes

- The embed MUST validate `e.source === window.parent` and origin against its allowlist before processing any message.
- Hosts MUST validate `e.source` is the expected iframe `contentWindow`.
- Neither side should `eval` or `new Function` message content.
- Sensitive user data in `host.hello` (`userId`, `userName`) should not be logged to an analytics pipeline without user consent.
