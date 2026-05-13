# Swap OpenAI Realtime TTS → ElevenLabs Streaming TTS

You are picking up a working two-agent X Spaces voice system. Right now each agent uses **OpenAI Realtime API** end-to-end (STT + LLM + TTS over a single WebRTC connection). The TTS voices are good but lack the prosody, emotion, and character of ElevenLabs voices.

Your task: **keep OpenAI Realtime for STT + LLM, replace its TTS with ElevenLabs streaming TTS**, while preserving the existing real-time conversation feel (target end-to-end latency ≤ 1.5s).

---

## Current architecture (do not break)

- Server: Node + Express + Socket.IO at `agent-voice-chat/server/index.js`.
- Two agent pages: `public/agent1.html`, `public/agent2.html`. Each:
  - Calls `GET /session/:id` to mint an OpenAI Realtime ephemeral key.
  - Opens a WebRTC `RTCPeerConnection` to `https://api.openai.com/v1/realtime/calls?model=gpt-realtime`.
  - Captures local mic via `getUserMedia` (routed through a PulseAudio virtual cable on a Linux VM).
  - Plays remote audio (model's voice) via a `<audio>` element that streams to another PulseAudio cable.
  - Uses a data channel `oai-events` for control events (`response.create`, `session.update`, etc.).
- Two agents are talking to each other and to humans in a live X Space. The Realtime model handles VAD, transcription, response generation, and speech synthesis.

You must not change:
- The PulseAudio cable routing (the audio still has to leave through the same `<audio>` element / default output device).
- The Socket.IO event flow between server and agent pages (status, textComplete, turn arbitration, etc.).
- The `/session/:id` ephemeral-key endpoint shape.

---

## Required changes

### 1. Server: add an ElevenLabs proxy endpoint

`ELEVENLABS_API_KEY` is already in `.env` next to `OPENAI_API_KEY`. Add a streaming proxy so the browser never sees the ElevenLabs key.

```js
// server/index.js
const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY
const ELEVEN_MODEL = process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5"
const VOICE_IDS = {
  0: process.env.ELEVEN_VOICE_0 || "21m00Tcm4TlvDq8ikWAM", // Rachel — pick something else for Swarm
  1: process.env.ELEVEN_VOICE_1 || "AZnzlk1XvdvUeBnXmlld", // Domi — pick something else for Swarm2
}

// HTTP streaming proxy. The page POSTs full text (or a chunk) and we stream MP3/PCM back.
app.post("/tts/:agentId/stream", express.json(), async (req, res) => {
  const id = parseInt(req.params.agentId, 10)
  const text = (req.body?.text || "").trim()
  const voiceId = VOICE_IDS[id]
  if (!text || !voiceId) return res.status(400).json({ error: "missing text or voice" })

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?optimize_streaming_latency=2&output_format=mp3_22050_32`
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVEN_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: ELEVEN_MODEL,
      voice_settings: { stability: 0.45, similarity_boost: 0.7, style: 0.2, use_speaker_boost: true },
    }),
  })
  if (!r.ok) {
    const err = await r.text()
    return res.status(r.status).send(err)
  }
  res.setHeader("Content-Type", "audio/mpeg")
  r.body.pipe(res)
})
```

Add `node-fetch` (or use undici / global `fetch` in Node 20+) and `express.json()` if it's not already enabled. Stream response, don't buffer.

### 2. Agent pages: switch Realtime to text-only output

Find each agent's session config (currently set via `session.update` or in the `/session/:id` response). Update it so the model produces TEXT instead of audio:

```js
// in agent1.html / agent2.html — after the WebRTC connection is established
dc.send(JSON.stringify({
  type: "session.update",
  session: {
    type: "realtime",
    output_modalities: ["text"],   // <-- model emits text only, no audio
    instructions: <existing system prompt>,
  }
}))
```

(If `output_modalities` doesn't work, the equivalent is `audio: { output: { modalities: ["text"] } }` — try `output_modalities` first.)

Once you've switched to text-only output, you should stop receiving `response.output_audio_transcript.*` events (the model isn't speaking) and instead receive **`response.output_text.delta`** and **`response.output_text.done`** events.

### 3. Pipe text to ElevenLabs as it streams

Currently the page listens for `response.output_audio_transcript.done` and emits `textComplete` to the server. Now you have two choices:

**Option A — simpler, slightly higher latency**: wait for `response.output_text.done`, send the full text to `/tts/:agentId/stream`, stream the MP3 into a fresh `<audio>` element.

**Option B — lower latency**: as `response.output_text.delta` events arrive, batch tokens by sentence (split on `.`, `?`, `!`, `,`) and fire a fresh `/tts/:agentId/stream` POST for each sentence. Each call streams an MP3 chunk; queue and play sequentially.

For X Spaces use, **Option A is good enough** (the model's text generation already streams faster than humans speak; whole sentences arrive in ~300–600ms after first token). Implement Option A first; Option B is an optimization.

```js
// in each agent page
else if (msg.type === "response.output_text.done") {
  if (msg.text) {
    socket.emit("textComplete", { agentId: AGENT_ID, text: msg.text, messageId: currentMessageId })
    addChat(AGENT_NAME, msg.text, "self")
    // Synthesize via ElevenLabs and play
    speakViaElevenLabs(msg.text)
  }
}

async function speakViaElevenLabs(text) {
  try {
    const res = await fetch(`/tts/${AGENT_ID}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) { log("TTS error: " + res.status, "error"); return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.onended = () => URL.revokeObjectURL(url)
    audio.play()
    setStatus("speaking")
    audio.onended = () => { setStatus("idle"); socket.emit("releaseTurn", { agentId: AGENT_ID }) }
  } catch (e) {
    log("TTS exception: " + e.message, "error")
  }
}
```

If `setStatus("speaking")` was previously driven by the audio-level analyzer reading from the WebRTC remote audio track, that analyzer won't see anything now (the model isn't sending audio). The simplest fix is to set status explicitly in `speakViaElevenLabs` before/after, as above.

### 4. Update the audio-level meter

The existing meter reads the OpenAI Realtime audio stream. After this change, that stream is silent. Make the meter analyze the new ElevenLabs `<audio>` element instead:

```js
function attachMeter(audioEl) {
  const ctx = audioContext || new (window.AudioContext || window.webkitAudioContext)()
  audioContext = ctx
  const src = ctx.createMediaElementSource(audioEl)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 256
  src.connect(analyser)
  src.connect(ctx.destination) // still play through speakers
  // ... reuse the existing setInterval loop that emits audioLevel events
}
```

Call `attachMeter(audio)` inside `speakViaElevenLabs` after creating the `Audio` element.

### 5. Voice picker (optional but nice)

Surface a tiny dropdown in each agent page that lets the operator change voice without redeploying:

```js
fetch("/voices").then(r => r.json()).then(voices => { /* populate select */ })
// On change: socket.emit("setVoice", { agentId, voiceId })
```

Server-side:
```js
app.get("/voices", async (req, res) => {
  const r = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": ELEVEN_KEY },
  })
  const data = await r.json()
  res.json(data.voices.map(v => ({ id: v.voice_id, name: v.name, description: v.labels?.description })))
})

io.on("connection", socket => {
  socket.on("setVoice", ({ agentId, voiceId }) => { VOICE_IDS[agentId] = voiceId })
})
```

### 6. Suggested voice picks

For two distinct, expressive, real-time-capable voices, start with:
- **Swarm (agent 0)**: a warm, conversational female voice — try **Rachel** (`21m00Tcm4TlvDq8ikWAM`) or **Bella** (`EXAVITQu4vr4xnSDxMaL`)
- **Swarm2 (agent 1)**: a drier, witty male voice — try **Adam** (`pNInz6obpgDQGcFmaJgB`) or **Antoni** (`ErXwobaYiN019PkySvjV`)

Browse + audition voices at https://elevenlabs.io/app/voice-library before committing.

Use the `eleven_turbo_v2_5` model — lowest latency, good quality, supports streaming. Avoid `eleven_multilingual_v2` unless you actually need other languages (slower).

---

## Latency budget (target ≤ 1.5s end to end)

| Stage | Estimate |
|---|---|
| Human stops speaking → Realtime VAD detects → STT text | 200–400 ms |
| LLM generates first sentence of response | 300–600 ms |
| Sentence sent to ElevenLabs → first audio bytes arrive | 250–500 ms |
| Audio decode + playback start | 50–150 ms |

Optimizations if you blow past 1.5s:
- Use `optimize_streaming_latency=3` or `4` in the EL URL (trades quality for speed).
- Implement Option B (per-sentence streaming).
- Use the WebSocket streaming endpoint (`/v1/text-to-speech/{voice_id}/stream-input`) instead of HTTP — slightly lower latency, more code.

---

## Test plan

1. Start with one agent only (agent1). Verify it speaks via ElevenLabs.
2. Check audio appears in the PulseAudio cable (`pactl list sink-inputs` on the VM should show audio active on `agent_speakers` while it speaks).
3. Verify the meter still pulses while it speaks.
4. Verify the `releaseTurn` fires after playback ends.
5. Verify the textComplete → textToAgent forwarder still triggers the other agent.
6. Then enable for both agents, run in a live X Space, listen.

## Don'ts

- Don't ship the ElevenLabs key to the browser. All EL calls go through the server proxy.
- Don't replace OpenAI Realtime for STT — its server-side VAD + transcription is what makes the agents respond to humans in real time. Only swap TTS.
- Don't try to use ElevenLabs Conversational AI as a drop-in replacement — that's a full agent stack and would require rewiring the two-agent coordination logic that lives in `index.js`.
- Don't lyric-sing copyrighted songs. ElevenLabs' content policy applies; original lyrics only.

## Files you'll touch

- `agent-voice-chat/server/index.js` — add `/tts/:agentId/stream`, `/voices`, `setVoice` socket handler
- `agent-voice-chat/server/public/agent1.html` and `agent2.html` — `session.update` to text-only, replace audio-out handling with ElevenLabs synth path, attach meter to new audio element
- `agent-voice-chat/server/package.json` — no new deps if you use global `fetch` (Node 20+)
- `agent-voice-chat/server/.env.example` — document the new env vars (`ELEVENLABS_API_KEY`, `ELEVEN_VOICE_0`, `ELEVEN_VOICE_1`, `ELEVENLABS_MODEL`)
