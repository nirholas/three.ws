# x-spaces — Autonomous AI Agent for X Spaces

A working setup for an AI agent that **joins an X (Twitter) Space as a speaker, holds a real-time voice conversation with humans in the room, and runs entirely in the cloud** — no audio devices, no virtual cables on your laptop, no fragile headless-browser stealth.

Built on:
- **OpenAI Realtime API** (`gpt-realtime`) — continuous WebRTC voice in/out, server-side VAD and turn-taking
- **A single GCP Compute Engine VM** running Ubuntu + Xvfb + PulseAudio + two Chrome processes
- **Puppeteer (CDP)** driving a real (non-headless) Chrome to click through X's UI
- **PulseAudio virtual cables** routing audio between the agent's tab and the X.com tab

Everything is open and reproducible. The full path from `gcloud compute instances create` to "the agent is speaking in the Space" is in this directory.

## What it does

1. You start an X Space on your **host** account (e.g. from your phone).
2. The VM logs into X as a **second account** (the agent's account, e.g. `@swarminged`) using saved cookies.
3. The VM joins your Space as a listener, requests speaker permission.
4. You accept the request on your phone.
5. The VM unmutes itself and starts a continuous voice loop:
   - **Hears** other speakers in the Space (X audio → PulseAudio cable B → agent's mic input)
   - **Speaks** via OpenAI Realtime audio output → PulseAudio cable A → X.com mic input → broadcast as the agent's voice

The system prompt and voice are configurable. The included default has the agent co-hosting a `three.ws` Space.

## Architecture

```
              ┌──────────────┐          ┌──────────────┐
              │  Your phone  │   ←──┐   │   Listeners  │
              │   (host)     │      │   │  in the Space│
              └──────┬───────┘      │   └──────▲───────┘
                     │ Space host   │          │
                     ▼              │          │
         ╔═══════════════════ X.com (live Space) ═══════════════════╗
         ║                                                          ║
GCP VM ──╫─► [X Chrome tab]  ← @swarminged speaker                  ║
         ║     PULSE_SINK=x_speakers (B)                            ║
         ║     PULSE_SOURCE=x_mic (= cable A monitor)               ║
         ║                                                          ║
         ║     audio out (other speakers)  ──► cable B ──┐          ║
         ║     audio in  (mic for @swarminged) ◄─ cable A│          ║
         ║                                               │          ║
         ║   [Agent Chrome tab → OpenAI Realtime WebRTC] │          ║
         ║     PULSE_SINK=agent_speakers (A)             │          ║
         ║     PULSE_SOURCE=agent_mic (= cable B monitor)│          ║
         ║                                                          ║
         ║     speaks  → cable A ───────────────────────┘           ║
         ║     listens ← cable B (from X tab's output)              ║
         ╚══════════════════════════════════════════════════════════╝
```

Two PulseAudio null-sinks act as virtual cables. Each Chrome process is launched with `PULSE_SINK` and `PULSE_SOURCE` env vars so its audio I/O is bound to a specific cable — clean separation, no per-tab fiddling.

## Repository layout

```
x-spaces/
├── README.md                  ← you are here
├── server/                    ← Node + OpenAI Realtime + per-agent web pages
│   ├── index.js               ← Express + Socket.IO; /session/:id mints ephemeral keys
│   ├── public/agent1.html     ← Swarm — verse voice, warm/curious
│   ├── public/agent2.html     ← Swarm2 — sage voice, drier humor
│   ├── public/index.html      ← optional dashboard
│   ├── package.json
│   └── .env.example
├── vm/
│   ├── setup.sh               ← one-shot bootstrap for a fresh Ubuntu 22.04 VM
│   ├── launch.sh              ← boots Xvfb, Pulse, Chromes, runs automation
│   └── swarm-server.service   ← systemd unit (auto-restart for Node server)
├── automation/
│   ├── vm-automation.js       ← full flow: cookies → join Space → request speaker
│   ├── x-join-only.js         ← just the X side (skip agent reconnect)
│   ├── unmute-only.js         ← finds + clicks the unmute button after host accepts
│   ├── unmute-and-greet.js    ← unmute then trigger fresh greeting via response.create
│   ├── reconnect-agent.js     ← reloads agent tab + re-clicks Connect (greeting refires)
│   ├── patch-realtime.py      ← historical: patches old Beta API → GA shape
│   ├── patch-greet.py         ← historical: adds the dc.onopen greeting trigger
│   └── .env.example
├── scripts/
│   └── say.sh                 ← OpenAI TTS → cable A (manual broadcast for testing)
└── docs/
    ├── architecture.md
    └── troubleshooting.md
```

## Prerequisites

- A GCP project with Compute Engine API enabled
- A second X account for the agent (cannot be the host; X disallows one account being both)
- OpenAI account with Realtime API access (`gpt-realtime` model)

## Setup (end to end)

### 1. Spin up a VM

```bash
gcloud compute instances create swarm-agent \
  --zone=us-central1-a \
  --machine-type=e2-standard-2 \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB \
  --no-service-account --no-scopes \
  --tags=swarm-agent
```

### 2. Bootstrap on the VM

SSH in, then:

```bash
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/nirholas/three.ws/main/x-spaces/vm/setup.sh)"
```

This installs Chrome, Node 20, Xvfb, PulseAudio with the two virtual cables, puppeteer-core, the server code, and the systemd unit. Idempotent.

### 3. Drop your secrets

```bash
# OpenAI key (for the Realtime API)
sudo -u agent tee /home/agent/ai-agents-x-space/.env <<EOF
OPENAI_API_KEY=sk-...
PORT=3000
EOF
sudo chmod 600 /home/agent/ai-agents-x-space/.env

# X cookies (auth_token + ct0) for the AGENT account — NOT the host account
sudo -u agent tee /home/agent/automation/.env <<EOF
X_AUTH_TOKEN=...
X_CT0=...
EOF
sudo chmod 600 /home/agent/automation/.env
```

To grab the cookies: open x.com in a browser logged in as the agent account, DevTools → Application → Cookies → copy `auth_token` and `ct0`.

### 4. Start the Node server

```bash
sudo systemctl enable --now swarm-server.service
curl http://localhost:3000/session/0   # should return a JSON object with "value": "ek_..."
```

### 5. Start an X Space (on your phone, as the host)

Get the Space URL — looks like `https://x.com/i/spaces/...`.

### 6. Launch the agent into the Space

```bash
sudo -u agent /home/agent/launch.sh https://x.com/i/spaces/SPACE_ID
```

This boots Xvfb + Pulse + two Chrome processes + runs the X automation:
- Sets the agent's X cookies via CDP
- Navigates the X Chrome to the Space URL
- Clicks "Start listening"
- Clicks "Request to speak"
- Opens the agent Chrome to `/agent1` and clicks Connect (Realtime session starts, greeting auto-fires)

### 7. Accept the speaker request on your phone

X notifies the host (you) that the agent's account wants to speak. Tap accept.

### 8. Unmute

```bash
sudo -u agent bash -c "cd /home/agent/automation && node unmute-only.js"
```

Now the agent's voice is live in the Space. The Realtime API handles VAD automatically: when a human in the Space talks, the agent hears them (via cable B) and replies (via cable A → X mic → broadcast).

### 9. Optional — test the audio path without the model

```bash
sudo -u agent /home/agent/say.sh "hello space, this is a test"
```

This synthesizes the text via OpenAI TTS and plays it through cable A. Useful for verifying routing without burning Realtime tokens.

## Customization

- **System prompt / personality**: edit `server/index.js`, the `prompts` and `baseInfo` constants.
- **Voice**: edit `server/index.js`, the `voices` constant. Options: `alloy`, `ash`, `ballad`, `coral`, `echo`, `sage`, `shimmer`, `verse`.
- **Add another agent**: copy `agent1.html` → `agentN.html`, change the `AGENT_ID` constant, add to `state.agents` / `prompts` / `voices` in `index.js`.

## Cost

- VM: `e2-standard-2`, ~$50/mo if left running.
- OpenAI Realtime: ~$0.06/min input audio + $0.24/min output audio with `gpt-realtime` (subject to change).
- For ad-hoc Spaces, stop the VM (`gcloud compute instances stop swarm-agent`) when not in use — only the disk costs ($1–2/mo) accrue while stopped.

## Known limitations

- **Single agent currently broadcasts**. The two-agent loop (Swarm + Swarm2 banter) is wired in the server but needs an additional event handler that forwards one agent's `response.done` text as the other's `textToAgent` input. PR welcome.
- **X UI changes** can break the automation. Selectors in `automation/*.js` look for text/aria labels like "Start listening", "Request to speak", "Unmute" — update them if X renames.
- **Echo / feedback** is not currently a problem because cable A and cable B are separate and X strips your own voice from playback. If you collapse them to one cable, expect feedback.
- **The X tab sometimes drifts** off the Space view (X bumps you to `/home`). The Space audio session usually keeps running underneath via X's persistent mini-player, but the unmute selector may be on the mini player rather than the full Space UI.

See [`docs/troubleshooting.md`](./docs/troubleshooting.md) for more.

## Security

- All secrets (`OPENAI_API_KEY`, X cookies) live in `.env` files with `chmod 600`. Never committed.
- The VM uses ephemeral external IP and no service account — minimum blast radius if compromised.
- X cookies are equivalent to passwords for that account; rotate (Settings → Security → Log out of all other sessions) after setup if you suspect exposure.

## License

Same as the parent repo (`nirholas/three.ws`).
