# 42 — Create avatar-chat test/demo page

## Status
Required — a dedicated test page makes it possible to verify all avatar-chat features quickly without navigating to the main app and loading an agent from scratch.

## File
Create: `public/test-avatar-chat.html`

## What to build

A standalone HTML page (no build step needed, using the dev server) that:

1. Loads `<agent-3d>` with a known-good avatar
2. Has a UI to toggle `avatar-chat="off"` on/off
3. Has buttons to trigger streaming, tool calls, and notifications manually
4. Shows the current state (walking, thinking, idle) in a debug panel

```html
<!DOCTYPE html>
<html>
<head>
  <title>Avatar-Chat Test</title>
  <style>
    body { margin: 0; background: #0b0d10; color: white; font-family: system-ui; }
    .container { display: flex; height: 100vh; gap: 16px; padding: 16px; box-sizing: border-box; }
    agent-3d { flex: 0 0 360px; height: 100%; }
    .controls { flex: 1; display: flex; flex-direction: column; gap: 12px; padding: 16px; }
    button { padding: 8px 16px; border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.05); color: white; border-radius: 8px; cursor: pointer; }
    button:hover { background: rgba(255,255,255,0.1); }
    .status { font-size: 12px; opacity: 0.6; padding: 8px; background: rgba(255,255,255,0.04); border-radius: 8px; }
    pre { margin: 0; font-size: 11px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="container">
    <agent-3d
      id="agent"
      src="/animations/robotexpressive.glb"
      brain="claude-opus-4-6"
      background="dark"
      mode="inline"
      responsive="false"
      width="360px"
      height="100%"
    ></agent-3d>

    <div class="controls">
      <h2>Avatar-Chat Test Panel</h2>

      <div>
        <strong>Layout Toggle</strong><br>
        <button onclick="toggle()">Toggle avatar-chat="off"</button>
        <span id="toggle-state">ON</span>
      </div>

      <div>
        <strong>Manual Triggers</strong><br>
        <button onclick="send('Hello, say something short.')">Short response</button>
        <button onclick="send('Write a detailed 3-paragraph explanation of how blockchain works.')">Long response</button>
        <button onclick="send('What are the trending tokens on pump.fun?')">Tool call (if skill installed)</button>
      </div>

      <div>
        <strong>Event Log</strong>
        <div class="status"><pre id="log"></pre></div>
      </div>
    </div>
  </div>

  <script type="module">
    import '/src/element.js';

    const agent = document.getElementById('agent');
    const log = document.getElementById('log');
    const toggleState = document.getElementById('toggle-state');
    let lines = [];

    function addLog(msg) {
      lines.unshift(`${new Date().toISOString().slice(11,23)} ${msg}`);
      lines = lines.slice(0, 20);
      log.textContent = lines.join('\n');
    }

    for (const ev of ['brain:thinking', 'brain:stream', 'brain:message', 'skill:tool-start', 'skill:tool-called', 'voice:speech-start', 'voice:speech-end']) {
      agent.addEventListener(ev, (e) => {
        const detail = ev === 'brain:stream'
          ? `chunk="${e.detail?.chunk?.slice(0,20)}…"`
          : JSON.stringify(e.detail || {}).slice(0, 60);
        addLog(`${ev} ${detail}`);
      });
    }

    window.toggle = () => {
      if (agent.getAttribute('avatar-chat') === 'off') {
        agent.removeAttribute('avatar-chat');
        toggleState.textContent = 'ON';
      } else {
        agent.setAttribute('avatar-chat', 'off');
        toggleState.textContent = 'OFF';
      }
    };

    window.send = (text) => agent.say(text);
  </script>
</body>
</html>
```

## Verification
Navigate to `http://localhost:3001/test-avatar-chat.html`. All buttons should work. The event log should show events firing in real time. Toggle should switch layouts.
