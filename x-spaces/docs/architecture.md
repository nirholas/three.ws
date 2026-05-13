# x-spaces — Architecture

## Why this setup exists

X Spaces don't have a public API for joining as a programmatic speaker. The only way for "an AI" to be in a Space is for a real X account, logged into a real browser, to:
1. Navigate to the Space URL
2. Click "Start listening"
3. Click "Request to speak"
4. Have the host accept the request (host-side, only on phone)
5. Click "Unmute" / "Start speaking"

X actively fingerprints headless browsers, so anything stealth-flagged tends to get challenged. The trick this repo uses is: **run a normal, non-headless Chrome** (just on a virtual display the user never sees) and drive it via Chrome DevTools Protocol. From X's perspective, it's a regular Chrome with a regular account.

For the audio, we need:
- A way to **inject** the AI's voice as the microphone input of that Chrome.
- A way to **capture** the Space's audio as the input that the AI listens to.

PulseAudio's `module-null-sink` does both — they're virtual audio devices that work like real ones but route in software.

## The two-cable model

```
 cable A: agent_speakers (null sink) → x_mic (remap of agent_speakers.monitor)
 cable B: x_speakers     (null sink) → agent_mic (remap of x_speakers.monitor)
```

A null sink's `.monitor` source is whatever was written to the sink. The `module-remap-source` lines just give those monitors friendly names so we can `PULSE_SOURCE=x_mic` and have Chrome see a clean input device.

Each Chrome process is launched with `PULSE_SINK` and `PULSE_SOURCE` env vars, so its outbound audio (anything it plays) and inbound audio (whatever it captures via `getUserMedia`) are bound to specific cables.

```
Agent Chrome:
  PULSE_SINK=agent_speakers   ← agent's voice (Realtime model output) writes here
  PULSE_SOURCE=agent_mic      ← agent's "microphone" reads from cable B's monitor

X.com Chrome:
  PULSE_SINK=x_speakers       ← Space audio (other speakers) writes here
  PULSE_SOURCE=x_mic          ← X's microphone reads from cable A's monitor
```

Net effect:
- Agent says something → cable A → X reads it as mic input → broadcast to Space.
- Other speaker says something in the Space → X plays it → cable B → agent reads it as mic input → Realtime model VAD picks it up → response.

## Why a single Chrome with two tabs doesn't work

A single Chrome process has process-wide `PULSE_SINK` / `PULSE_SOURCE`. Both tabs would share the same input/output devices. You'd need to use Chrome's per-tab `setSinkId` API plus per-call `getUserMedia({audio: {deviceId}})` constraints — which is more code and more failure modes than just launching two Chrome processes.

## Server (OpenAI Realtime API)

```
[browser tab /agent1]
   │
   │ GET /session/0
   ▼
[Node server (index.js)]
   │
   │ POST /v1/realtime/client_secrets
   │   { session: { type: "realtime", model: "gpt-realtime",
   │                audio: { output: { voice: "verse" } },
   │                instructions: "..." } }
   ▼
[OpenAI]
   │
   │ { value: "ek_...", expires_at, session }
   ▼
[browser tab]
   │ uses ek_... as ephemeral Bearer
   │ POST /v1/realtime/calls?model=gpt-realtime (SDP exchange)
   ▼
[WebRTC peer connection established]
   │ audio in: browser mic (cable B) → OpenAI
   │ audio out: OpenAI → <audio> element (cable A)
   │ data channel: oai-events (response.create, response.done, etc.)
```

The data channel is how the page tells OpenAI things like "respond now" (`response.create`). We use this for the greeting: as soon as `dc.onopen` fires, the page sends a `response.create` event with `response.instructions` describing what to say, and the model generates a greeting in audio without waiting for user input.

## Greet-on-connect

The patched `agent1.html` includes this snippet immediately after the data channel opens:

```js
dc.onopen = () => {
  log("Data channel open", "success")
  setTimeout(() => {
    dc.send(JSON.stringify({
      type: "response.create",
      response: { instructions: "Greet the room warmly..." }
    }))
  }, 1500)
}
```

The 1.5s delay gives the WebRTC stream time to stabilize before the model starts speaking.

## API drift history

The original `ai-agents-x-space` repo this is forked from used the **Beta** Realtime API, which OpenAI retired around 2026-02:

| What changed | Old (Beta) | New (GA) |
|---|---|---|
| Ephemeral key endpoint | `POST /v1/realtime/sessions` | `POST /v1/realtime/client_secrets` |
| Session body wrapper | top-level fields | `{ session: { ... } }` |
| Voice param location | `voice: "verse"` (top-level) | `audio: { output: { voice: "verse" } }` |
| SDP exchange endpoint | `POST /v1/realtime?model=...` | `POST /v1/realtime/calls?model=...` |
| Ephemeral key field | `data.client_secret.value` | `data.value` |
| Model name | `gpt-4o-realtime-preview-2024-12-17` | `gpt-realtime` |

The patches in `automation/patch-realtime.py` and `automation/patch-greet.py` made these migrations. The server in this repo already has the GA shape baked in.

## Why the VM, not the user's laptop

The original `ai-agents-x-space` README assumes you run it on your Mac with BlackHole to bridge audio to an X.com browser tab. That works but requires:
- Installing BlackHole on macOS
- Running a Chrome tab + the Node server on your machine
- Leaving your machine on for the duration of the Space

Putting everything on a small GCP VM:
- Zero local setup beyond a phone for accepting speaker requests
- Runs 24/7 without your laptop
- PulseAudio's two-cable layout works cleanly on Linux (cleaner than single-cable BlackHole)
- The agent's X tab is a real Chrome (not headless), so X doesn't flag it
