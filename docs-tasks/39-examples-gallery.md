# Agent Task: Write "Examples Gallery" Documentation

## Output file
`public/docs/examples.md`

## Target audience
Developers who want working code to copy and adapt. This page is a gallery of complete, runnable examples — not explanations of concepts, just code that works.

## Word count
2000–3000 words

## What this document must cover

The document should be organized as a gallery of examples. Each example needs:
1. A title and one-sentence description
2. What it demonstrates
3. The complete, copy-paste ready code
4. A "try it" link to a live demo (link to the equivalent in `/examples/` directory)
5. "What to change" — 2-3 bullet points for quick customization

### Example 1: Minimal model viewer
**The absolute simplest possible setup — just a 3D model.**

Reference: `/examples/minimal.html`

```html
<!DOCTYPE html>
<html>
<head>
  <title>3D Viewer</title>
  <style>
    body { margin: 0; background: #111; }
    agent-3d { width: 100vw; height: 100vh; display: block; }
  </style>
</head>
<body>
  <script type="module" src="https://cdn.three.wsagent-3d.js"></script>
  <agent-3d model="https://cdn.three.wsmodels/sample.glb"></agent-3d>
</body>
</html>
```

What to change:
- Replace the `model` URL with your own GLB
- Change `background` color to match your brand
- Add `kiosk` attribute to hide controls

---

### Example 2: Auto-rotating product display (turntable)
**A rotating 3D product — zero controls, just the model spinning.**

```html
<!DOCTYPE html>
<html>
<head>
  <title>Product</title>
  <style>
    body { margin: 0; background: #f8f8f8; display: flex; justify-content: center; align-items: center; height: 100vh; }
    agent-3d { width: 500px; height: 500px; border-radius: 16px; }
  </style>
</head>
<body>
  <script type="module" src="https://cdn.three.wsagent-3d.js"></script>
  <agent-3d
    widget="turntable"
    model="https://cdn.three.wsmodels/sample.glb"
    auto-rotate-speed="0.5"
    kiosk
    preset="neutral"
  ></agent-3d>
</body>
</html>
```

What to change:
- `auto-rotate-speed` — 0.1 (slow) to 3.0 (fast)
- `preset` — `venice`, `footprint`, or `neutral` for different lighting
- Add a `<figcaption>` below for a product name label

---

### Example 3: Talking agent with chat UI
**A full AI-powered agent that responds to text messages.**

```html
<!DOCTYPE html>
<html>
<head>
  <title>Chat with Aria</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0d0d1a; font-family: system-ui, sans-serif; color: white; height: 100vh; display: grid; grid-template-rows: 1fr auto; }
    agent-3d { width: 100%; flex: 1; }
    .chat { padding: 16px; border-top: 1px solid #222; display: flex; gap: 8px; }
    input { flex: 1; padding: 10px 14px; background: #1a1a2e; border: 1px solid #333; border-radius: 8px; color: white; font-size: 15px; }
    button { padding: 10px 20px; background: #6366f1; border: none; border-radius: 8px; color: white; cursor: pointer; font-size: 15px; }
  </style>
</head>
<body>
  <script type="module" src="https://cdn.three.wsagent-3d.js"></script>
  <agent-3d id="aria" model="https://cdn.three.wsmodels/aria.glb" brain style="height:calc(100vh - 60px);display:block">
    <script type="application/json" slot="manifest">
    {
      "name": "Aria",
      "personality": {
        "prompt": "You are Aria, a friendly AI assistant. Be helpful and concise."
      }
    }
    </script>
  </agent-3d>

  <div class="chat">
    <input id="input" type="text" placeholder="Ask Aria something..." autofocus>
    <button onclick="send()">Send</button>
  </div>

  <script>
    const aria = document.getElementById('aria');
    const input = document.getElementById('input');
    input.addEventListener('keypress', e => { if (e.key === 'Enter') send(); });
    function send() {
      const msg = input.value.trim();
      if (!msg) return;
      input.value = '';
      aria.sendMessage(msg);
    }
  </script>
</body>
</html>
```

What to change:
- Replace the system prompt with your agent's personality and knowledge
- Replace the model URL with your GLB
- Add `skills='[...]'` attribute for custom skills

---

### Example 4: Two agents talking to each other
**Two agents side by side — click to start a conversation between them.**

Reference: `/examples/two-agents.html` — read that file and present its code with explanation.

Walk through the key parts:
- Two `<agent-3d>` elements with different agents
- Event listener on Agent 1's `agent-speak` that forwards to Agent 2
- Turn-taking via `{ once: true }` event listeners
- A start button to kick off the conversation

---

### Example 5: React component wrapper
**A reusable React component for `<agent-3d>`.**

```jsx
// components/AgentViewer.jsx
import { useEffect, useRef, useState } from 'react';
import '@3dagent/sdk';

export function AgentViewer({ agentId, model, mode = 'inline', onSpeak, style }) {
  const ref = useRef();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const handleReady = () => setReady(true);
    const handleSpeak = e => onSpeak?.(e.detail.text);

    el.addEventListener('ready', handleReady);
    el.addEventListener('agent-speak', handleSpeak);
    return () => {
      el.removeEventListener('ready', handleReady);
      el.removeEventListener('agent-speak', handleSpeak);
    };
  }, [onSpeak]);

  return (
    <agent-3d
      ref={ref}
      agent-id={agentId}
      model={model}
      mode={mode}
      style={{ display: 'block', ...style }}
    />
  );
}

// Usage:
// <AgentViewer agentId="aria" style={{ width: '400px', height: '500px' }} onSpeak={text => console.log(text)} />
```

---

### Example 6: Event-driven integration
**Listening to agent events to drive a custom UI.**

```html
<agent-3d id="agent" agent-id="your-id" style="width:400px;height:500px;display:block"></agent-3d>

<div id="transcript" style="max-height:200px;overflow-y:auto;padding:16px;background:#111;color:#ddd;font-size:14px"></div>

<script type="module">
  import 'https://cdn.three.wsagent-3d.js';

  const agent = document.getElementById('agent');
  const transcript = document.getElementById('transcript');

  function addLine(speaker, text) {
    const p = document.createElement('p');
    p.style.margin = '4px 0';
    p.innerHTML = `<strong style="color:${speaker === 'Agent' ? '#6366f1' : '#aaa'}">${speaker}:</strong> ${text}`;
    transcript.appendChild(p);
    transcript.scrollTop = transcript.scrollHeight;
  }

  agent.addEventListener('ready', () => {
    addLine('System', 'Agent loaded and ready');
  });

  agent.addEventListener('agent-speak', e => {
    addLine('Agent', e.detail.text);
  });

  agent.addEventListener('agent-emote', e => {
    addLine('System', `[Agent feels: ${e.detail.emotion} (${(e.detail.intensity * 100).toFixed(0)}%)]`);
  });

  agent.addEventListener('agent-remember', e => {
    addLine('System', `[Agent remembered: ${e.detail.key} = ${e.detail.value}]`);
  });

  agent.addEventListener('skill-done', e => {
    addLine('System', `[Skill "${e.detail.skill}" completed]`);
  });
</script>
```

---

### Example 7: Programmatic model switcher
**Load different models dynamically based on user selection.**

```html
<agent-3d id="viewer" style="width:400px;height:400px;display:block"></agent-3d>

<div style="display:flex;gap:8px;margin-top:12px">
  <button onclick="load('https://cdn.three.wsmodels/avatar1.glb')">Avatar 1</button>
  <button onclick="load('https://cdn.three.wsmodels/avatar2.glb')">Avatar 2</button>
  <button onclick="load('https://cdn.three.wsmodels/product.glb')">Product</button>
</div>

<script type="module">
  import 'https://cdn.three.wsagent-3d.js';
  window.load = async (url) => {
    const el = document.getElementById('viewer');
    await el.loadGLB(url);
  };
</script>
```

---

### Example 8: Screenshot button
**Capture a PNG of the current viewer state.**

```html
<agent-3d id="viewer" model="./product.glb" style="width:400px;height:400px;display:block"></agent-3d>
<button onclick="capture()">Download Screenshot</button>

<script type="module">
  import 'https://cdn.three.wsagent-3d.js';
  window.capture = () => {
    const el = document.getElementById('viewer');
    const dataUrl = el.screenshot();
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'model-screenshot.png';
    a.click();
  };
</script>
```

---

### Example 9: Iframe postMessage
**Control an embedded agent from the host page.**

```html
<!-- host.html -->
<iframe id="embed" src="https://three.ws/agent-embed?id=your-id" width="400" height="500"></iframe>

<button onclick="greet()">Say Hello</button>
<button onclick="screenshot()">Screenshot</button>

<script>
  const iframe = document.getElementById('embed');

  function greet() {
    iframe.contentWindow.postMessage({ type: '3dagent:speak', text: 'Hello from the host!' }, 'https://three.ws/');
  }

  function screenshot() {
    iframe.contentWindow.postMessage({ type: '3dagent:screenshot' }, 'https://three.ws/');
  }

  window.addEventListener('message', e => {
    if (e.origin !== 'https://three.ws/') return;
    if (e.data.type === '3dagent:screenshot') {
      const img = document.createElement('img');
      img.src = e.data.dataUrl;
      img.style.width = '200px';
      document.body.appendChild(img);
    }
  });
</script>
```

---

### Example 10: The Coach Leo agent
**A full working example of a custom AI agent with personality and skills.**

Reference: `/examples/coach-leo/`

Describe what's in that directory:
- `manifest.json` — full agent manifest
- `instructions.md` — the personality system prompt
- `SKILL.md` — skill documentation

Show the manifest structure and explain the key design decisions:
- How the personality prompt gives Leo his coaching voice
- How skills extend what Leo can do
- How memory lets Leo remember users between sessions

Link to the full files in the repository.

## Tone
Code-first. Minimal prose. Each example should be copy-paste ready and immediately runnable. The "what to change" bullets help readers adapt examples to their use case quickly.

## Files to read for accuracy
- `/examples/minimal.html`
- `/examples/two-agents.html`
- `/examples/web-component.html`
- `/examples/coach-leo/manifest.json`
- `/examples/coach-leo/instructions.md`
- `/examples/skills/wave/`
- `/src/element.js` — for accurate API (loadGLB, sendMessage, screenshot, etc.)
- `/specs/EMBED_HOST_PROTOCOL.md` — postMessage API
