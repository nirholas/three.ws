# agent-3d

Embed and fully control the `<agent-3d>` Three.js avatar web component. One script tag, zero build step — renders a glTF/GLB-backed AI avatar with voice I/O, live LLM brain, gestures, emotes, and a typed postMessage host API.

| Property      | Value                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| name          | agent-3d                                                                               |
| description   | Embed and control the `<agent-3d>` web component — attributes, postMessage API, avatars |
| allowed-tools | Read, Edit, Write                                                                      |

## Install

```
openclaw skills install agent-3d
```

Or via direct URL:

```
Install the skill https://raw.githubusercontent.com/nirholas/3D-Agent/main/clawhub-skills/agent-3d/SKILL.md
```

## Zero-config embed

```html
<script type="module" src="https://cdn.three.ws/agent-3d.js"></script>
<agent-3d src="agent://base/42"></agent-3d>
```

That's the complete install for the majority of use cases. Everything else is optional.

## Core workflow

```
1. Pick a source   →  src / agent-id / manifest / body
2. Configure scene →  environment, shadows, camera-controls, background
3. Configure brain →  brain, key-proxy, instructions, thinking
4. Set layout      →  mode, position, width, height
5. (Optional) Control from host page via postMessage API
```

## Source forms

| Attribute  | Example                                 | Use case                     |
| ---------- | --------------------------------------- | ---------------------------- |
| `src`      | `agent://base/42`                       | On-chain agent by token ID   |
| `agent-id` | `agent-id="42" chain-id="8453"`         | Same, explicit chain         |
| `agent-id` | `agent-id="a_abc123"`                   | Backend account (legacy)     |
| `manifest` | `manifest="ipfs://bafy.../manifest.json"` | Direct IPFS/HTTPS manifest |
| `body`     | `body="./cz.glb"`                       | Ad-hoc GLB, no agent account |

## Layout modes

### Inline (default)

Fills the parent container. Good for dedicated avatar sections.

```html
<div style="width:400px; height:600px;">
  <agent-3d src="agent://base/42"></agent-3d>
</div>
```

### Floating

Anchored overlay, like a chat widget.

```html
<agent-3d
  src="agent://base/42"
  mode="floating"
  position="bottom-right"
  width="320px"
  height="480px"
></agent-3d>
```

### Fullscreen

```html
<agent-3d src="agent://base/42" mode="fullscreen"></agent-3d>
```

## Avatar chat mode

By default, the avatar is embedded inside the chat flow: it walks during streaming, displays thought bubbles, and stays anchored to the message list. To use the legacy bottom-bar layout:

```html
<agent-3d src="agent://base/42" avatar-chat="off"></agent-3d>
```

## Scene configuration

```html
<agent-3d
  src="agent://base/42"
  environment="city"
  background="#0d0d0d"
  shadows
  exposure="1.2"
  camera-controls
  auto-rotate
></agent-3d>
```

Available `environment` presets: `neutral`, `city`, `dawn`, `forest`, `lobby`, `night`, `park`, `studio`, `sunset`, `warehouse`. Also accepts any HDRI URL.

## Brain configuration

```html
<!-- Point to your own key proxy for production -->
<agent-3d
  src="agent://base/42"
  brain="claude-opus-4-6"
  key-proxy="https://your-api.com/proxy"
  instructions="https://your-cdn.com/system-prompt.md"
  thinking="auto"
></agent-3d>
```

## PostMessage host API

Control the avatar from the parent page. The embed speaks a versioned postMessage protocol — send requests, receive responses and event streams.

### Complete example

```js
const iframe = document.createElement('iframe');
iframe.src = 'https://three.ws/agent/a_abc123/embed';
document.body.appendChild(iframe);

let targetOrigin = null;

window.addEventListener('message', async (e) => {
  if (!e.data || e.data.v !== 1) return;

  // Step 1: embed announces ready
  if (e.data.kind === 'event' && e.data.op === 'ready') {
    targetOrigin = e.origin;

    // Step 2: subscribe to receive action events
    iframe.contentWindow.postMessage(
      { v: 1, source: 'agent-host', kind: 'request', op: 'subscribe', id: '1' },
      targetOrigin,
    );
  }

  // Step 3: receive action events from the avatar
  if (e.data.kind === 'event' && e.data.op === 'action') {
    const { type, payload } = e.data.payload;
    console.log('avatar action:', type, payload);
  }
});

// Send an action after setup
function sendAction(op, payload = {}) {
  if (!targetOrigin) return;
  iframe.contentWindow.postMessage(
    { v: 1, source: 'agent-host', kind: 'request', op, payload, id: crypto.randomUUID() },
    targetOrigin,
  );
}

// Examples
sendAction('speak',   { text: 'Welcome!', sentiment: 0.8 });
sendAction('gesture', { name: 'wave', duration: 1.5 });
sendAction('emote',   { trigger: 'curiosity', weight: 0.9 });
sendAction('look',    { target: 'user' });
```

### Action reference

| `op`        | Payload                                              | Notes                                   |
| ----------- | ---------------------------------------------------- | --------------------------------------- |
| `speak`     | `text`, `sentiment?` (−1 to 1)                       | Text-to-speech + lip sync               |
| `gesture`   | `name`, `duration?` (seconds)                        | Named body animation                    |
| `emote`     | `trigger`, `weight?` (0–1)                           | Blend-tree emotion injection            |
| `look`      | `target` (`"user"`, `"camera"`, or `{x,y,z}`)        | Head/eye look-at                        |
| `ping`      | —                                                    | Returns `{ capabilities: [...] }`       |
| `listClips` | —                                                    | Returns `{ clips: [{name, label, ...}] }` |
| `subscribe` | —                                                    | Opt-in to receive action events         |

### Gesture names

`wave` · `celebrate` · `shrug` · `nod` · `point` · `bow`

### Emote triggers

`curiosity` · `celebration` · `patience` · `concern` · `joy` · `neutral`

## Skills integration

Load extra skills at embed time using the `skills` attribute:

```html
<agent-3d
  src="agent://base/42"
  skills="ipfs://bafy.../pump-fun-reactive/, ipfs://bafy.../custom-skill/"
  skill-trust="any"
></agent-3d>
```

## Voice

Voice I/O is enabled automatically when the manifest includes a voice config. Override per-embed:

```html
<!-- Push-to-talk mic (default) -->
<agent-3d src="agent://base/42" voice mic="push-to-talk"></agent-3d>

<!-- Continuous mic (always listening) -->
<agent-3d src="agent://base/42" voice mic="continuous"></agent-3d>

<!-- No mic — text only -->
<agent-3d src="agent://base/42" voice mic="off"></agent-3d>

<!-- Disable voice entirely -->
<agent-3d src="agent://base/42"></agent-3d>
```

## Common patterns

### Greeting on page load

```js
window.addEventListener('message', (e) => {
  if (e.data?.kind === 'event' && e.data?.op === 'ready') {
    setTimeout(() => {
      iframe.contentWindow.postMessage(
        { v: 1, source: 'agent-host', kind: 'request', op: 'speak',
          payload: { text: 'Hey! Ask me anything.', sentiment: 0.6 },
          id: crypto.randomUUID() },
        e.origin,
      );
    }, 800);
  }
});
```

### React to user scroll

```js
let lastScrollY = 0;
document.addEventListener('scroll', () => {
  const delta = window.scrollY - lastScrollY;
  if (Math.abs(delta) > 200) {
    sendAction('emote', { trigger: 'curiosity', weight: 0.5 });
  }
  lastScrollY = window.scrollY;
});
```

### Dark mode sync

```js
const observer = new MutationObserver(() => {
  const dark = document.documentElement.classList.contains('dark');
  el.setAttribute('background', dark ? '#0d0d0d' : 'transparent');
  el.setAttribute('environment', dark ? 'night' : 'neutral');
});
observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
```

## Source

Embed spec: [`specs/EMBED_SPEC.md`](https://github.com/nirholas/3D-Agent/blob/main/specs/EMBED_SPEC.md)

Host protocol: [`specs/EMBED_HOST_PROTOCOL.md`](https://github.com/nirholas/3D-Agent/blob/main/specs/EMBED_HOST_PROTOCOL.md)
