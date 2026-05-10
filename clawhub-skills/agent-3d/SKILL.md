---
name: agent-3d
description: Embed and control the <agent-3d> Three.js avatar web component — configure attributes, wire the postMessage host API, and drive gestures, emotes, and speech from any web page.
allowed-tools: Read, Edit, Write
---

# agent-3d

The `<agent-3d>` custom element renders an AI-powered 3D avatar backed by a glTF/GLB model, a live LLM brain, and a full AgentProtocol event bus. Drop one script tag on any page and the avatar is live.

```html
<script type="module" src="https://cdn.three.ws/agent-3d.js"></script>
<agent-3d src="agent://base/42"></agent-3d>
```

## Source selection

Exactly one source attribute is required. Priority order: `src` > `agent-id` > `manifest` > `body`.

| Attribute  | Form                     | Example                               |
| ---------- | ------------------------ | ------------------------------------- |
| `src`      | on-chain URI             | `agent://base/42`                     |
| `agent-id` | numeric + `chain-id`     | `agent-id="42" chain-id="8453"`       |
| `agent-id` | CAIP-10                  | `agent-id="eip155:8453:0xReg…:42"`    |
| `agent-id` | shorthand                | `agent-id="onchain:8453:42"`          |
| `agent-id` | backend account id       | `agent-id="a_abc123"`                 |
| `manifest` | IPFS or HTTPS URL        | `manifest="ipfs://bafy.../manifest.json"` |
| `body`     | bare GLB (ad-hoc avatar) | `body="./cz.glb"`                     |

## Scene attributes

| Attribute         | Type                       | Default     |
| ----------------- | -------------------------- | ----------- |
| `poster`          | URL                        | none        |
| `environment`     | preset name or HDRI URL    | `neutral`   |
| `camera-controls` | boolean                    | off         |
| `auto-rotate`     | boolean                    | off         |
| `ar`              | boolean                    | off         |
| `shadows`         | boolean                    | on          |
| `exposure`        | number                     | 1.0         |
| `background`      | CSS color or `transparent` | transparent |
| `skybox`          | URL                        | none        |

## Brain attributes

| Attribute      | Type                      | Default       |
| -------------- | ------------------------- | ------------- |
| `brain`        | model id                  | from manifest |
| `api-key`      | string                    | none (dev only) |
| `key-proxy`    | URL                       | none          |
| `instructions` | URL or inline string      | from manifest |
| `thinking`     | `auto`\|`always`\|`never` | `auto`        |

## Voice attributes

| Attribute | Type                                | Default        |
| --------- | ----------------------------------- | -------------- |
| `voice`   | boolean                             | on (if in manifest) |
| `tts`     | provider id                         | browser        |
| `stt`     | provider id                         | browser        |
| `mic`     | `push-to-talk`\|`continuous`\|`off` | `push-to-talk` |

## Layout attributes

| Attribute     | Type                                                  | Default    |
| ------------- | ----------------------------------------------------- | ---------- |
| `mode`        | `inline`\|`floating`\|`section`\|`fullscreen`         | `inline`   |
| `position`    | `bottom-right`\|`bottom-left`\|`top-right`\|`top-left`\|`bottom-center` | `bottom-right` |
| `width`       | CSS length                                            | `100%`     |
| `height`      | CSS length                                            | `100%`     |
| `scale`       | number                                                | 1.0        |
| `avatar-chat` | `"off"` to disable                                    | on         |
| `avatar-walk` | `"off"` to disable                                    | on         |

## Postmessage host API

When embedding `<agent-3d>` inside your own iframe flow, communicate with it via the versioned postMessage bridge. Send requests to the iframe; receive responses and events back.

### Handshake

```js
const iframe = document.querySelector('iframe');

// 1. Receive ready event from the embed
window.addEventListener('message', (e) => {
  if (e.data?.kind === 'event' && e.data?.op === 'ready') {
    // 2. Subscribe to action events
    iframe.contentWindow.postMessage(
      { v: 1, source: 'agent-host', kind: 'request', op: 'subscribe', id: '1' },
      e.origin,
    );
  }
});
```

### Sending actions

All action requests follow the same envelope:

```js
iframe.contentWindow.postMessage(
  { v: 1, source: 'agent-host', kind: 'request', op: '<op>', payload: { ... }, id: '<uuid>' },
  targetOrigin,
);
```

| `op`      | Payload fields                                  | Effect                             |
| --------- | ----------------------------------------------- | ---------------------------------- |
| `speak`   | `text: string`, `sentiment?: number (–1 to 1)`  | Avatar speaks the text aloud       |
| `gesture` | `name: string`, `duration?: number (seconds)`   | Plays a named body gesture         |
| `emote`   | `trigger: string`, `weight?: number (0–1)`      | Injects an emotion blend           |
| `look`    | `target: 'user' \| 'camera' \| Vector3`         | Directs the avatar's gaze          |
| `ping`    | none                                            | Health check, returns capabilities |
| `listClips` | none                                          | Returns available animation clips  |

### Gesture names

`wave`, `celebrate`, `shrug`, `nod`, `point`, `bow`

### Emote triggers

`curiosity`, `celebration`, `patience`, `concern`, `joy`, `neutral`

### Receiving events

After subscribing, all protocol events are forwarded to the host:

```js
window.addEventListener('message', (e) => {
  if (e.data?.kind === 'event' && e.data?.op === 'action') {
    const { type, payload } = e.data.payload;
    // type: 'speak' | 'gesture' | 'emote' | 'look-at' | ...
  }
});
```

## Skills attribute

Load extra skills at embed time:

```html
<agent-3d
  src="agent://base/42"
  skills="ipfs://bafy.../pump-fun-reactive/"
  skill-trust="any"
></agent-3d>
```

## Common patterns

### Floating avatar with camera controls

```html
<agent-3d
  src="agent://base/42"
  mode="floating"
  position="bottom-right"
  width="320px"
  height="480px"
  camera-controls
  environment="city"
></agent-3d>
```

### Ad-hoc GLB preview (no on-chain agent)

```html
<agent-3d
  body="./my-character.glb"
  camera-controls
  auto-rotate
  environment="neutral"
  background="#1a1a2e"
></agent-3d>
```

### Programmatic speak via postMessage

```js
function speak(iframe, text, sentiment = 0) {
  iframe.contentWindow.postMessage(
    { v: 1, source: 'agent-host', kind: 'request', op: 'speak',
      payload: { text, sentiment }, id: crypto.randomUUID() },
    '*',
  );
}
speak(document.querySelector('iframe'), 'Hello, world!', 0.7);
```
