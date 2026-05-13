# Build a Real-Time Dashboard for the x-spaces Voice Agent

You are picking up a working multi-agent voice system that broadcasts into X (Twitter) Spaces. Two AI agents (Swarm + Swarm2) connect to **OpenAI Realtime API** over WebRTC, talk to each other and to humans in the Space, and broadcast through a single X.com browser tab via PulseAudio virtual cables on a GCP VM.

Your task is to build a **real-time dashboard** that surfaces everything happening in this system to a human operator.

---

## Stack you're working with

- **Server**: Node + Express + Socket.IO at `nirholas/three.ws/agent-voice-chat/server/index.js`. Already exposes:
  - `GET /` → static dashboard (currently a basic ASCII/terminal style page in `public/index.html`). You'll be modernizing this.
  - `GET /state` → JSON: `{ agents, currentTurn, messages }` (last 50 messages)
  - `GET /session/:agentId` → mints an OpenAI Realtime ephemeral key (don't touch)
  - `GET /config` → frontend config dump
  - Socket.IO with the events listed below
- **Agent pages**: `public/agent1.html`, `public/agent2.html` — each renders one agent's WebRTC connection + status. **Do not modify these.** They are the source of truth for what each agent is doing.
- **Run target**: served from `http://localhost:3000` on the same VM where the Node server runs.

---

## Socket.IO events emitted by the server (you SUBSCRIBE to these)

| Event | Payload | When it fires |
|---|---|---|
| `stateUpdate` | `{ agents, currentTurn, turnQueue }` | Any agent connects/disconnects/changes status, turn granted/released |
| `agentStatus` | `{ agentId, status, name }` | An agent's status changed (`idle` / `listening` / `speaking` / `offline`) |
| `turnGranted` | `{ agentId }` | Server granted the floor to an agent |
| `textDelta` | `{ agentId, delta, messageId, name }` | An agent's response is streaming (token by token) |
| `textComplete` | `{ id, agentId, name, text, timestamp }` | An agent finished a turn (final transcript) |
| `userMessage` | `{ id, agentId: -1, name, text, timestamp, isUser: true }` | A human typed a message in the dashboard |
| `audioLevel` | `{ agentId, level }` | Agent's current audio output level (0.0–1.0), ~30 Hz |
| `messageHistory` | `Array<message>` | Sent once on connection — backlog of the last 50 messages |
| `pumpfunMessage` | `{ agentId: -1, name, text, timestamp, source: "pumpfun" }` | (optional) Live external chat feed if enabled |

Plus the existing flow already wires `textComplete` → `textToAgent` on the *other* agent so the two agents banter when neither is busy.

## Socket.IO events you can EMIT from the dashboard (the server is listening)

| Event | Payload | Effect |
|---|---|---|
| `userMessage` | `{ text, from }` | Inject a user message — the active agent will respond to it |
| `requestTurn` / `releaseTurn` | `{ agentId }` | Turn arbitration (you probably don't need these) |

---

## What the dashboard MUST show in real time

1. **Top bar**:
   - Server status indicator (Socket.IO connected/disconnected)
   - Active X Space URL (you may need to add a `/space-info` endpoint to the server — read it from a config var like `process.env.SPACE_URL` and have the operator set it)
   - "Two agents talking" indicator (`currentTurn` field) — show which agent has the floor right now

2. **Agent panels** (one per agent, side by side):
   - Name + voice
   - Status badge with colors: `idle` (gray), `listening` (yellow), `speaking` (green pulsing), `offline` (red)
   - Live audio meter (use `audioLevel` events, 0.0–1.0, animated bar)
   - Current message being generated (use `textDelta` events — typewriter effect appending deltas as they arrive)
   - System prompt for that agent (read once from `/state` or a new endpoint; display in a collapsible panel)
   - Voice (from `voices` map in server — add a `/agent-config` endpoint if needed)

3. **Live transcript feed** (main center panel, scrollable, auto-scroll to bottom):
   - One entry per turn — agent name, color-coded, timestamp, text
   - Stream `textDelta` events as a partial entry that finalizes on `textComplete`
   - Distinguish humans in the X Space from agents — humans show up as `userMessage` (typed) OR via a NEW event you'll wire up: `humanTranscript`. To support that, also subscribe to a new event:
     ```
     socket.on("humanTranscript", ({ text, timestamp }) => { ... })
     ```
     Then ADD a server-side rebroadcast: when an agent page emits an internal `userTranscript` event (you'll need to patch agent1.html / agent2.html to emit this — see below), the server should rebroadcast as `humanTranscript`.

4. **Input controls**:
   - Text box → emits `userMessage` to inject a typed message
   - "Kick Swarm" / "Kick Swarm2" buttons → call a NEW endpoint `POST /kick/:agentId` (add to server) that sends `response.create` to that agent's data channel. You'll need to coordinate with the agent page via Socket.IO since the data channel lives in the browser, not the server. The simplest path: emit a Socket.IO event `kickRequest` to the agent page and have the agent page (the agent's tab) call `dc.send(...)`.
   - "Update prompt" button per agent → opens a textarea and emits `promptUpdate { agentId, instructions }` (server forwards to agent page, agent page calls `dc.send({ type: "session.update", ... })`)

5. **System health panel**:
   - PulseAudio sink-input counts (one for agent Chrome, one for X Chrome — query via a NEW `/health` endpoint that runs `pactl list short sink-inputs` on the VM)
   - Realtime session ephemeral key expiration (mint a fresh key at `/session/0` and `/session/1` periodically to show "minutes until refresh")
   - X tab URL (run a query via a NEW `/x-tab-url` endpoint that uses puppeteer-core to connect to `http://127.0.0.1:9223` and report the X.com Chrome's current URL)

---

## Patches you need to make to existing files

### `public/agent1.html` and `public/agent2.html`

Currently each agent's data channel `message` handler logs `User said: ...` to the page DOM but doesn't emit it to the server. Find this block (it exists in both files):

```js
else if (msg.type === "conversation.item.created" && msg.item?.role === "user") {
  const content = msg.item.content || []
  let text = ""
  content.forEach(c => {
    if (c.transcript) text += c.transcript
    if (c.text) text += c.text
  })
  if (text.trim()) {
    log("User said: " + text)
  }
}
```

Add `socket.emit("userTranscript", { agentId: AGENT_ID, text, timestamp: Date.now() })` inside the `if (text.trim())` block, immediately after the `log()` call. Do this in **both** agent files.

### `server/index.js`

Add a Socket.IO handler that rebroadcasts `userTranscript` events as `humanTranscript` to all clients (so dashboards see it):

```js
socket.on("userTranscript", ({ agentId, text, timestamp }) => {
  io.emit("humanTranscript", { agentId, text, timestamp })
})
```

Add the kick + prompt-update bridge:

```js
socket.on("kickRequest", ({ agentId, instructions }) => {
  const target = state.agents[agentId]
  if (!target || !target.socketId) return
  io.to(target.socketId).emit("kickAgent", { instructions })
})

socket.on("promptUpdate", ({ agentId, instructions }) => {
  const target = state.agents[agentId]
  if (!target || !target.socketId) return
  io.to(target.socketId).emit("updatePrompt", { instructions })
})
```

In `agent1.html` and `agent2.html`, listen for these new events:

```js
socket.on("kickAgent", ({ instructions }) => {
  if (!dc || dc.readyState !== "open") return
  dc.send(JSON.stringify({ type: "response.create", response: { instructions } }))
})

socket.on("updatePrompt", ({ instructions }) => {
  if (!dc || dc.readyState !== "open") return
  dc.send(JSON.stringify({ type: "session.update", session: { type: "realtime", instructions } }))
})
```

Add the health endpoint:

```js
const { exec } = require("child_process")
app.get("/health", (req, res) => {
  exec("pactl list short sink-inputs && pactl list short sources", (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message })
    res.json({ pulse: stdout, uptime: process.uptime() })
  })
})
```

Add the X tab URL endpoint (requires puppeteer-core in the server's deps — `npm install puppeteer-core`):

```js
const puppeteer = require("puppeteer-core")
app.get("/x-tab-url", async (req, res) => {
  try {
    const b = await puppeteer.connect({ browserURL: "http://127.0.0.1:9223", defaultViewport: null })
    const pages = await b.pages()
    const urls = pages.map(p => p.url())
    b.disconnect()
    res.json({ urls })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})
```

---

## Build constraints

- **No build step.** This dashboard must be a single `dashboard.html` (or `index.html`) plus a CSS file and an inline `<script type="module">`. Operator wants to edit + reload without npm builds.
- **Use Socket.IO client directly** via `<script src="/socket.io/socket.io.js">`.
- **Light DOM updates only** — no React/Vue/Svelte. Plain JS or alpine.js if you really want reactivity.
- **Dark theme**, modern, readable. Inspired by terminals but not strict ASCII. Use system fonts (`-apple-system, ui-sans-serif`).
- **Responsive** — should work in a Chrome side-panel at 600 px wide as well as full screen.

## Layout suggestion

```
┌────────────────────────────────────────────────────────────────┐
│ ●  Connected · Space: x.com/i/spaces/...  · Now speaking: Swarm│
├──────────────────┬──────────────────┬──────────────────────────┤
│  SWARM (marin)   │  SWARM2 (cedar)  │  TRANSCRIPT              │
│  ● speaking      │  ● idle          │  [22:14] Swarm:  ...     │
│  ▓▓▓▓░░░░░░ 47%  │  ░░░░░░░░░░  0%  │  [22:14] Swarm2: ...     │
│                  │                  │  [22:14] HUMAN: hi!      │
│  current msg:    │  last msg:       │  [22:15] Swarm:  ...     │
│  "yo three.ws is │  "no doubt..."   │  ...                     │
│   shipping..."   │                  │  (auto-scroll bottom)    │
│  ─────────────── │ ─────────────────│                          │
│  [kick] [prompt] │  [kick] [prompt] │                          │
└──────────────────┴──────────────────┴──────────────────────────┤
│ Inject message: [____________________________________] [send]  │
├────────────────────────────────────────────────────────────────┤
│ HEALTH:  Pulse sinks: ok · X tab: /spaces/...  · uptime: 14m   │
└────────────────────────────────────────────────────────────────┘
```

## File you should produce

Replace (or sit alongside) `agent-voice-chat/server/public/index.html`. If you sit alongside, name it `dashboard.html` and update `index.js`'s `app.get("/")` to serve it instead.

Also add `agent-voice-chat/server/public/dashboard.css` and any small `dashboard.js` you split out.

## How to test

1. SSH to the VM (`gcloud compute ssh swarm-agent --zone=us-central1-a`)
2. `sudo systemctl restart swarm-server.service`
3. From your laptop: `gcloud compute ssh swarm-agent --zone=us-central1-a -- -L 3000:localhost:3000` then open `http://localhost:3000` locally
4. Open one of the agent pages too (`/agent1`, `/agent2`) so there's something to dashboard
5. Verify status badges, audio meter, transcript stream, kick button, prompt update

## Don'ts

- Don't replace the agent pages. Don't refactor the server's existing flow (textComplete forwarder + Realtime session minter). Only add the new events/endpoints listed above.
- Don't add a database. Keep transcript state in memory or `localStorage`.
- Don't break the existing turn-queue / textComplete forwarder behavior.

When you're done, the human operator should be able to open one tab and see everything: which agent is speaking, what humans are saying in the Space, the running transcript, agent voice levels, and have one-click kick / prompt-update controls.
