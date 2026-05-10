---
name: embed-agent
description: >
  Embed a three.ws embodied 3D AI agent anywhere on the web using the
  <agent-3d> web component. Covers all attributes, embed modes, brain/voice
  configuration, event API, and JavaScript control. No install required.
metadata:
  author: three.ws
  version: "1.0"
---

# Embed an Agent with `<agent-3d>`

The `<agent-3d>` web component ships the entire three.ws runtime as a single script. Drop it on any page — no build step, no npm, no backend.

## Minimal embed

```html
<script type="module" src="https://three.ws/agent-3d.js"></script>

<agent-3d src="agent://base/42"></agent-3d>
```

That's the full install for most use cases. Everything else below is optional.

## Source attributes (pick one)

| Attribute | Form | Example |
|-----------|------|---------|
| `src` | on-chain URI | `agent://base/42` |
| `agent-id` | numeric id | `agent-id="42" chain-id="8453"` |
| `agent-id` | CAIP-10 + tokenId | `agent-id="eip155:8453:0xReg…:42"` |
| `agent-id` | shorthand | `agent-id="onchain:8453:42"` |
| `agent-id` | backend account id | `agent-id="a_abc123"` |
| `manifest` | IPFS or HTTPS URL | `manifest="ipfs://Qm.../manifest.json"` |
| `body` | bare GLB (ad-hoc) | `body="./my-model.glb"` |

Priority when multiple are set: `src` > `agent-id` > `manifest` > `body`.

## Scene attributes

| Attribute | Type | Default | Notes |
|-----------|------|---------|-------|
| `environment` | preset or HDRI URL | `neutral` | tone-mapped IBL; presets: `neutral`, `warehouse`, `forest`, `apartment`, `studio`, `city`, `dawn`, `night` |
| `camera-controls` | boolean | off | orbit, pan, zoom |
| `auto-rotate` | boolean | off | slow Y-axis spin |
| `ar` | boolean | off | WebXR / Scene Viewer / Quick Look |
| `shadows` | boolean | on | contact shadows |
| `exposure` | number | `1.0` | tone-map exposure |
| `background` | CSS color or `transparent` | transparent | canvas clear color |
| `skybox` | URL | none | HDRI as visible sky |
| `poster` | URL | none | image shown during load |

## Brain attributes

| Attribute | Type | Default | Notes |
|-----------|------|---------|-------|
| `brain` | model id | from manifest | `claude-opus-4-6`, `gpt-4o`, `none` |
| `key-proxy` | URL | none | your backend that injects the API key — preferred for production |
| `instructions` | URL or inline text | from manifest | overrides the manifest's instructions.md |
| `thinking` | `auto`\|`always`\|`never` | `auto` | extended thinking hint |

Never put `api-key` in production HTML — use `key-proxy` instead.

## Voice attributes

| Attribute | Type | Default | Notes |
|-----------|------|---------|-------|
| `voice` | boolean | on (if manifest has voice) | master on/off |
| `tts` | provider id | `browser` | `browser`, `elevenlabs`, `openai`, `none` |
| `stt` | provider id | `browser` | `browser`, `whisper`, `none` |
| `mic` | `push-to-talk`\|`continuous`\|`off` | `push-to-talk` | mic policy |

## Skills attributes

| Attribute | Type | Notes |
|-----------|------|-------|
| `skills` | comma-separated URIs | adds to (or replaces) manifest skills |
| `skills-only` | boolean | ignore manifest skills; use only `skills` attribute |
| `skill-trust` | `any`\|`whitelist`\|`owned-only` | overrides manifest default |

## Layout / embed mode

| Attribute | Type | Default | Notes |
|-----------|------|---------|-------|
| `mode` | `inline`\|`floating`\|`section`\|`fullscreen` | `inline` | layout mode |
| `position` | `bottom-right`\|`bottom-left`\|`top-right`\|`top-left`\|`bottom-center` | `bottom-right` | for `floating` mode |
| `offset` | CSS length pair | `24px 24px` | distance from edge in `floating` mode |
| `width` | CSS length | `100%` / `320px` | — |
| `height` | CSS length | `100%` / `480px` | — |
| `scale` | number | `1.0` | camera zoom multiplier |
| `avatar-chat` | `"off"` | on | set `"off"` to disable the integrated avatar-in-chat layout |
| `avatar-walk` | `"off"` | on | set `"off"` to stop walk animation during streaming |

## Common patterns

### Floating chat widget (bottom-right corner)

```html
<agent-3d
  src="agent://base/42"
  mode="floating"
  position="bottom-right"
  width="320px"
  height="480px"
  brain="claude-opus-4-6"
  key-proxy="/api/llm-proxy"
></agent-3d>
```

### Inline 3D viewer (no chat)

```html
<agent-3d
  body="https://cdn.example.com/coach-leo.glb"
  brain="none"
  camera-controls
  auto-rotate
  environment="studio"
  width="100%"
  height="500px"
></agent-3d>
```

### Fullscreen experience

```html
<agent-3d
  src="agent://base/42"
  mode="fullscreen"
  brain="claude-opus-4-6"
  key-proxy="/api/llm-proxy"
  voice
  mic="push-to-talk"
></agent-3d>
```

### Ad-hoc GLB preview with orbit controls

```html
<agent-3d
  body="./my-character.glb"
  brain="none"
  camera-controls
  shadows
  environment="warehouse"
></agent-3d>
```

## JavaScript control

The element exposes a DOM API for programmatic control:

```js
const el = document.querySelector('agent-3d');

// Wait for the runtime to be ready
el.addEventListener('agent-ready', () => {
  // Trigger a gesture
  el.gesture('wave');

  // Make the agent speak
  el.speak('Hello, welcome!', { sentiment: 0.8 });

  // Fire an emote
  el.emote({ trigger: 'excited', weight: 1 });

  // Switch to a different agent
  el.setAgent('a_xyz123');
});

// Listen for user messages
el.addEventListener('agent-message', (e) => {
  console.log('user said:', e.detail.text);
});

// Listen for agent replies
el.addEventListener('agent-reply', (e) => {
  console.log('agent replied:', e.detail.text);
});
```

## Memory attributes

| Attribute | Type | Default | Notes |
|-----------|------|---------|-------|
| `memory` | `local`\|`ipfs`\|`encrypted-ipfs`\|`none` | from manifest | override storage mode |
| `memory-key` | string | agentId | namespace for memory storage |

## Browser support

Any browser with ES modules + WebGL 2. Chrome, Firefox, Safari 16+, Edge. WebXR requires a compatible device and HTTPS.
