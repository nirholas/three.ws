---
name: embed-agent
description: >
  Embed a three.ws embodied 3D AI agent anywhere on the web using the
  <agent-3d> web component. Covers all attributes, embed modes, brain/voice
  configuration, the real JavaScript DOM API, and all custom events. No install required.
metadata:
  author: three.ws
  version: "1.1"
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
| `src` | on-chain URI | `src="agent://base/42"` |
| `agent-id` | numeric id | `agent-id="42" chain-id="8453"` |
| `agent-id` | CAIP-10 | `agent-id="eip155:8453:0xReg…:42"` |
| `agent-id` | shorthand | `agent-id="onchain:8453:42"` |
| `agent-id` | backend account id | `agent-id="a_abc123"` |
| `manifest` | IPFS or HTTPS URL | `manifest="ipfs://Qm.../manifest.json"` |
| `body` | bare GLB | `body="./my-model.glb"` |

Priority when multiple are set: `src` > `agent-id` > `manifest` > `body`.

## Scene attributes

| Attribute | Type | Default | Notes |
|-----------|------|---------|-------|
| `environment` | preset or HDRI URL | `neutral` | Presets: `neutral`, `warehouse`, `forest`, `apartment`, `studio`, `city`, `dawn`, `night` |
| `camera-controls` | boolean | off | Orbit, pan, zoom |
| `auto-rotate` | boolean | off | Slow Y-axis spin |
| `ar` | boolean | off | WebXR / Scene Viewer / Quick Look |
| `shadows` | boolean | on | Contact shadows |
| `exposure` | number | `1.0` | Tone-map exposure |
| `background` | CSS color or `transparent` | transparent | Canvas clear color |
| `skybox` | URL | none | HDRI as visible sky |
| `poster` | URL | none | Image shown while loading |

## Brain attributes

| Attribute | Type | Default | Notes |
|-----------|------|---------|-------|
| `brain` | model id | from manifest | `claude-opus-4-6`, `claude-sonnet-4-6`, `gpt-4o`, `none` |
| `key-proxy` | URL | `/api/llm/anthropic?agent=<id>` | Your backend that injects the API key — required in production |
| `instructions` | URL or inline text | from manifest | Overrides manifest's `instructions.md` |
| `thinking` | `auto`\|`always`\|`never` | `auto` | Extended thinking hint |

The three.ws platform provides a built-in proxy at `/api/llm/anthropic?agent=<agentId>` — use this when serving via three.ws. For self-hosted, point `key-proxy` at your own endpoint that injects the key server-side.

Do not put an API key directly in HTML. Use `key-proxy` instead.

## Voice attributes

| Attribute | Type | Default | Notes |
|-----------|------|---------|-------|
| `voice` | boolean | on (if manifest has voice) | Master on/off |
| `tts` | provider id | `browser` | `browser`, `elevenlabs`, `openai`, `none` |
| `stt` | provider id | `browser` | `browser`, `whisper`, `none` |
| `mic` | `push-to-talk`\|`continuous`\|`off` | `push-to-talk` | Mic policy |

## Skills attributes

| Attribute | Type | Notes |
|-----------|------|-------|
| `skills` | comma-separated URIs | Adds to (or replaces) manifest skills |
| `skills-only` | boolean | Ignore manifest skills; use only `skills` attribute |
| `skill-trust` | `any`\|`whitelist`\|`owned-only` | Overrides manifest default |

## Layout / embed mode

| Attribute | Type | Default | Notes |
|-----------|------|---------|-------|
| `mode` | `inline`\|`floating`\|`section`\|`fullscreen` | `inline` | Layout mode |
| `position` | `bottom-right`\|`bottom-left`\|`top-right`\|`top-left`\|`bottom-center` | `bottom-right` | Only for `floating` mode |
| `offset` | CSS length pair | `24px 24px` | Distance from edge in `floating` mode |
| `width` | CSS length | `100%` inline / `320px` floating | — |
| `height` | CSS length | `100%` inline / `480px` floating | — |
| `scale` | number | `1.0` | Camera zoom multiplier |
| `avatar-chat` | `"off"` | on | Set to `"off"` to disable the integrated avatar-in-chat layout |
| `avatar-walk` | `"off"` | on | Set to `"off"` to stop walk animation during streaming |

## Memory attributes

| Attribute | Type | Default | Notes |
|-----------|------|---------|-------|
| `memory` | `local`\|`ipfs`\|`encrypted-ipfs`\|`none` | from manifest | Override storage mode |
| `memory-key` | string | agentId | Namespace for memory storage |

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

### Inline 3D viewer (no chat, no brain)

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

### Fullscreen embodied experience

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

### Ad-hoc GLB drop with orbit controls

```html
<agent-3d
  body="./my-character.glb"
  brain="none"
  camera-controls
  shadows
  environment="warehouse"
></agent-3d>
```

## JavaScript DOM API

After `agent:ready` fires, you can drive the agent programmatically.

```js
const el = document.querySelector('agent-3d');

el.addEventListener('agent:ready', async () => {
  // Send a user message to the LLM — agent thinks and replies
  el.say('What can you tell me about this model?');

  // Or await the reply text
  const reply = await el.ask('Describe yourself in one sentence.');
  console.log('Agent replied:', reply);

  // Play a wave animation
  el.wave();

  // Play any animation clip by name (from the GLB or manifest)
  el.play('dance');
  el.play('idle');

  // Play a named emote: 'cheer', 'flinch', 'celebrate'
  el.playEmote('celebrate');
  el.playEmote('flinch', 0.5); // second arg is intensity (default 1)

  // Look at a target
  el.lookAt('user');
  el.lookAt('model');

  // Clear conversation history (fresh context for the LLM)
  el.clearConversation();
});
```

**Method summary:**

| Method | Signature | Notes |
|--------|-----------|-------|
| `say(text, opts?)` | `void` | Sends text to the LLM; agent thinks → replies → speaks |
| `ask(text, opts?)` | `Promise<string>` | Same as `say` but awaits and returns the reply text |
| `wave(opts?)` | `Promise` | Plays the wave animation |
| `play(name, opts?)` | `Promise` | Plays a named clip from the GLB or manifest |
| `playEmote(name, intensity?)` | `boolean` | Named emote: `'cheer'`, `'flinch'`, `'celebrate'` |
| `lookAt(target)` | `Promise` | `'user'` or `'model'` or a THREE.Vector3 |
| `clearConversation()` | `void` | Resets LLM message history |

## Events

Listen on the element:

```js
// Loading
el.addEventListener('agent:ready',         (e) => { /* e.detail.agentId */ });
el.addEventListener('agent:error',         (e) => { /* e.detail.phase, e.detail.error */ });
el.addEventListener('agent:load-progress', (e) => { /* e.detail.phase, e.detail.pct (0–1) */ });

// Brain
el.addEventListener('brain:stream',   (e) => { /* e.detail.chunk — live text delta */ });
el.addEventListener('brain:message',  (e) => { /* e.detail.message.role, e.detail.message.content */ });
el.addEventListener('brain:thinking', (e) => { /* e.detail.thinking: true/false */ });

// Skills
el.addEventListener('skill:tool-start',       (e) => { /* e.detail.name */ });
el.addEventListener('skill:tool-called',      (e) => { /* e.detail.name, e.detail.result */ });
el.addEventListener('skill:loaded',           (e) => { /* e.detail.name */ });
el.addEventListener('skill:payment-required', (e) => { /* e.detail — payment info */ });
el.addEventListener('skill:purchased',        (e) => { /* e.detail */ });

// Voice
el.addEventListener('voice:speech-start', (e) => { /* e.detail.text */ });
el.addEventListener('voice:speech-end',   () => {});
```

**Load progress phases:** `manifest` (0.1 → 0.3) → `body` (0.45) → `memory` (0.6) → `skills` (0.75) → `brain` (0.9) → `agent:ready`

## Browser support

Any browser with ES modules + WebGL 2. Chrome, Firefox, Safari 16+, Edge. WebXR requires HTTPS and a compatible device.
