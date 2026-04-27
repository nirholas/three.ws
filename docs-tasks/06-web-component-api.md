# Agent Task: Write "Web Component API Reference" Documentation

## Output file
`public/docs/web-component.md`

## Target audience
Developers embedding `<agent-3d>` in their own pages or apps. Needs to be a complete API reference — every attribute, property, method, and event.

## Word count
2000–3000 words

## What this document must cover

### 1. Overview
`<agent-3d>` is a custom HTML element (Web Component) that encapsulates the entire three.ws stack. Drop a script tag, use the element — no framework required.

```html
<script type="module" src="https://cdn.three.wsagent-3d.js"></script>
<agent-3d model="./avatar.glb" style="width:400px;height:500px"></agent-3d>
```

### 2. How it boots
Describe the lifecycle:
1. Element added to DOM → connected callback fires
2. IntersectionObserver starts — element waits until visible (lazy loading)
3. When visible: canvas created, three.js renderer initialized
4. `agent-id` resolved → manifest fetched → GLB loaded
5. Agent runtime started (if brain mode enabled)
6. `ready` event fired on the element

### 3. HTML attributes (full table)

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `model` | URL | — | GLB/glTF URL to load |
| `agent-id` | string | — | Agent manifest ID to load from platform |
| `widget` | string | — | Widget type: `turntable`, `talking-agent`, `animation-gallery`, `passport`, `hotspot-tour` |
| `mode` | string | `inline` | Layout: `inline`, `floating`, `section`, `fullscreen` |
| `skills` | JSON | — | Inline skill config (JSON string) |
| `brain` | boolean | false | Enable LLM runtime |
| `kiosk` | boolean | false | Hide all controls (presentation mode) |
| `preset` | string | — | Environment preset name |
| `camera-position` | string | — | Initial camera position as `x,y,z` |
| `proxy-url` | string | — | CORS proxy for model loading |
| `env-map` | URL | — | Custom HDR environment map URL |
| `auto-rotate` | boolean | false | Auto-rotate model (turntable) |
| `auto-rotate-speed` | number | 1 | Rotation speed multiplier |
| `exposure` | number | 1 | Renderer exposure |
| `shadow-intensity` | number | 1 | Shadow softness |
| `ar` | boolean | false | Show AR button (iOS/Android) |

For each attribute: description, accepted values, default, example.

### 4. JavaScript properties
Properties readable/writable after the element boots:

```js
const el = document.querySelector('agent-3d');

el.model           // current model URL
el.agentId         // current agent ID
el.viewer          // the Viewer instance (three.js scene)
el.agent           // the Agent runtime instance
el.ready           // Promise that resolves when booted
```

### 5. Methods

**loadGLB(url)**
```js
await el.loadGLB('https://example.com/new-model.glb');
```
Unloads current model, loads new one. Returns Promise.

**loadAgent(id)**
```js
await el.loadAgent('my-agent-id');
```
Fetches manifest by ID and boots agent runtime.

**playClip(name, loop?)**
```js
el.playClip('wave', false);
```

**screenshot()**
```js
const dataUrl = el.screenshot();
// PNG data URL
```

**setExpression(emotion, intensity)**
```js
el.setExpression('celebration', 0.8);
```

**speak(text)**
```js
await el.speak('Hello, welcome to my portfolio!');
```
Triggers TTS and avatar emotion.

**sendMessage(text)**
```js
await el.sendMessage('What animations do you have?');
```
Sends user message to agent runtime (LLM processes it).

### 6. Events (fired on the element)

| Event | Detail | Description |
|-------|--------|-------------|
| `ready` | — | Element fully booted |
| `load-start` | `{ url }` | Model loading started |
| `load-end` | `{ success, error? }` | Model loading complete |
| `agent-speak` | `{ text }` | Agent said something |
| `agent-think` | `{ text }` | Agent internal thought |
| `agent-emote` | `{ emotion, intensity }` | Emotion state changed |
| `agent-gesture` | `{ name }` | Gesture triggered |
| `agent-remember` | `{ key, value }` | Memory written |
| `skill-done` | `{ skill, result }` | Skill completed |
| `validation` | `{ report }` | Validation result ready |

Listening example:
```js
el.addEventListener('agent-speak', e => {
  console.log('Agent said:', e.detail.text);
});
```

### 7. postMessage bridge (for iframe embeds)
When `<agent-3d>` is used inside an `<iframe>`, the host page can communicate via postMessage.

**Host → Embed (commands):**
```js
iframe.contentWindow.postMessage({
  type: '3dagent:load',
  model: 'https://example.com/avatar.glb'
}, '*');
```

| Message type | Payload | Description |
|-------------|---------|-------------|
| `3dagent:load` | `{ model }` | Load a new GLB |
| `3dagent:speak` | `{ text }` | Trigger agent speech |
| `3dagent:message` | `{ text }` | Send user message to LLM |
| `3dagent:expression` | `{ emotion, intensity }` | Set expression |
| `3dagent:screenshot` | — | Request screenshot |

**Embed → Host (events):**
```js
window.addEventListener('message', e => {
  if (e.data.type === '3dagent:ready') { /* ... */ }
});
```

| Message type | Payload | Description |
|-------------|---------|-------------|
| `3dagent:ready` | — | Embed booted |
| `3dagent:speak` | `{ text }` | Agent spoke |
| `3dagent:screenshot` | `{ dataUrl }` | Screenshot PNG |

### 8. Display modes

**inline** (default)
Fills the container. Set width/height via CSS on the element.
```html
<agent-3d model="./avatar.glb" style="width:100%;height:400px"></agent-3d>
```

**floating**
Renders as a floating panel (fixed position, bottom-right by default).
```html
<agent-3d mode="floating" agent-id="my-agent"></agent-3d>
```

**section**
Full-width section layout, good for marketing pages.

**fullscreen**
Takes over the viewport.

### 9. Kiosk mode
`kiosk` attribute hides all controls (GUI panel, animation tabs, editor links). Use for presentation/display contexts where you don't want users exploring.
```html
<agent-3d model="./product.glb" kiosk auto-rotate></agent-3d>
```

### 10. CSP and sandboxing
`<agent-3d>` is CSP-compatible:
- No inline `<script>` tags
- No `eval()`
- External resources loaded only from URLs you provide
- Works inside sandboxed iframes (though `allow-scripts` is required)

Add `allow-scripts allow-same-origin` to the iframe `sandbox` attribute.

### 11. Framework usage

**React:**
```jsx
import '@3dagent/sdk';
// Declare custom element for TypeScript
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'agent-3d': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        model?: string; 'agent-id'?: string; widget?: string;
      }
    }
  }
}

function MyComponent() {
  return <agent-3d model="/avatar.glb" style={{ width: '400px', height: '500px' }} />;
}
```

**Vue:**
```js
// vite.config.js
export default {
  plugins: [vue({ template: { compilerOptions: { isCustomElement: tag => tag === 'agent-3d' } } })]
}
```

**Svelte:**
Works out of the box with custom elements.

**Vanilla JS (ESM):**
```js
import 'https://cdn.three.wsagent-3d.js';
```

## Tone
Reference documentation. Exhaustive. Tables for attributes, events, postMessage types. Code examples for every method. Developers will bookmark this page.

## Files to read for accuracy
- `/src/element.js` (1146 lines — read fully, this is the primary source)
- `/src/lib.js` — CDN export
- `/specs/EMBED_SPEC.md` — embed protocol
- `/specs/EMBED_HOST_PROTOCOL.md` — postMessage spec
- `/examples/minimal.html`
- `/examples/web-component.html`
- `/examples/two-agents.html`
