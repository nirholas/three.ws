> **Internal Planning Document** — Not part of the public documentation.

> **Outdated**: This describes a previous combined system design that is no longer relevant. See [architecture-overview.md](./architecture-overview.md) for current architecture.

# Prompt: Combined System — Talky Characters Live in X Spaces

## Context
This is the third project variant that combines both systems: the Talky AI character cast performs **live** inside X/Twitter Spaces via the Puppeteer automation. Instead of 1-2 generic agents, you have 5 distinct AI personalities with unique voices having a live show inside a real X Space.

## Vision
A **live AI show in X Spaces** where multiple AI characters with distinct personalities and voices:
- Auto-converse with each other (the "show")
- Respond to live Space speakers (audience interaction)
- React to external events (trades, tweets, chat messages)
- All controlled from an enhanced admin panel

Think of it as a podcast/radio show run entirely by AI characters, broadcast live on X Spaces.

## Architecture

```
combined-system/
├── server.js                     ← Slim entry point
├── package.json
├── .env.example
├── Procfile
│
├── cast/
│   ├── characters.json           ← Character definitions (name, personality, voice, model)
│   ├── director.js               ← Director AI: picks who speaks, manages flow
│   └── index.js                  ← Cast loader and manager
│
├── x-spaces/                     ← Browser automation (from X Space agent)
│   ├── index.js                  ← Orchestrator with state machine
│   ├── browser.js                ← Puppeteer launch with stealth
│   ├── auth.js                   ← X login (cookies, auth_token, form+2FA)
│   ├── selectors.js              ← CSS selectors for X UI
│   ├── space-ui.js               ← DOM interactions (join, speak, unmute, leave)
│   └── audio-bridge.js           ← Bidirectional audio (capture + inject)
│
├── conversation/
│   ├── engine.js                 ← Event queue, auto-conversation timer, priority system
│   ├── modes.js                  ← Conversation modes (free-talk, debate, interview, Q&A)
│   ├── space-listener.js         ← Processes audio from Space speakers → feeds to engine
│   └── history.js                ← Per-character conversation history
│
├── pipeline/
│   ├── stt.js                    ← Speech-to-text (Groq/OpenAI Whisper)
│   ├── llm.js                    ← LLM routing (per-character model config)
│   ├── tts.js                    ← Text-to-speech (ElevenLabs per-character voice)
│   └── audio-queue.js            ← Queues TTS output, prevents overlap, manages speaking turns
│
├── integrations/                 ← Optional event sources
│   ├── pump-fun-chat.js
│   ├── pump-portal.js
│   ├── birdeye.js
│   └── twitter.js
│
├── admin/
│   ├── routes.js                 ← Express routes for admin API
│   └── socket-handlers.js        ← Socket.IO handlers for admin control
│
├── public/
│   ├── admin.html                ← Enhanced admin panel (see below)
│   ├── index.html                ← Live show viewer/dashboard
│   ├── style.css
│   └── js/
│       ├── admin.js
│       ├── dashboard.js
│       └── audio-player.js
│
└── docs/
    └── architecture.md
```

## Key Differences from Standalone Systems

### Multi-Character Audio Pipeline
Instead of 1-2 agents sharing one audio stream, the combined system needs:

```
Space Audio In → STT → "Who should respond?" (Director AI)
                                    │
                        ┌───────────┼───────────┐
                        ▼           ▼           ▼
                    Character A  Character B  Character C
                    (Claude)     (GPT)       (Groq)
                        │           │           │
                        ▼           ▼           ▼
                    TTS (voice A) TTS (voice B) TTS (voice C)
                        │           │           │
                        └───────────┼───────────┘
                                    ▼
                            Audio Queue Manager
                            (one at a time into Space)
```

### Director AI
The Director is the brain of the show. It decides:
- **Who responds** to Space speakers (pick the most relevant character)
- **Auto-conversation flow** — picks speaker + target for idle conversations
- **Conversation mode** — switches between free-talk, debate, interview based on context
- **Pacing** — adjusts idle timer based on energy (fast exchanges vs thoughtful pauses)
- **Interrupts** — can cut off a character if someone more relevant should speak

### Audio Queue Manager
Critical new component. Since all characters share one audio output to the Space:
- Characters "request" to speak (like the existing turn system but for 5+ characters)
- Queue manages order, prevents overlap
- Director can re-order queue based on relevance
- Each character's TTS audio is played sequentially through the audio bridge

### Conversation Modes
```json
{
  "free-talk": "Characters chat naturally, director picks speakers",
  "debate": "Two characters argue a topic, others can interject",
  "interview": "One character interviews a Space speaker",
  "q-and-a": "Characters answer audience questions in round-robin",
  "roast": "Characters roast each other or a topic (original Talky mode)"
}
```
Admin can switch modes. Director auto-selects based on context if set to "auto".

### Enhanced Admin Panel
Extends the existing admin.html with:
- **Character roster** — see all 5 characters, toggle active/inactive per character
- **Mode selector** — dropdown to switch conversation modes
- **Character stats** — messages sent, avg response time, last spoke
- **Live transcript** — scrolling transcript with character names color-coded
- **Volume/speed controls** — per-character TTS speed and pitch
- **Topic injection** — text input to inject a topic for characters to discuss
- **Integration toggles** — enable/disable data feeds in real-time

### Dashboard (public/index.html)
The viewer page shows:
- All active characters with their ASCII art and accent colors
- Live transcript with typewriter effect
- Currently speaking character highlighted/animated
- Audience chat (from Space speakers, pump.fun, Twitter)
- Optional: trade ticker, market cap display

## Implementation Strategy

### Phase 1: Foundation
1. Start from the X Space agent codebase (working Puppeteer + audio pipeline)
2. Add character system (characters.json + cast loader)
3. Modify audio pipeline to support per-character TTS voices
4. Add audio queue manager for sequential character speaking

### Phase 2: Director & Conversation Engine
5. Build Director AI that routes incoming audio/events to characters
6. Port conversation engine from Talky (event queue, auto-timer, priority)
7. Add conversation modes (start with free-talk and roast)
8. Wire Space audio → Director → Character → TTS → Audio Bridge

### Phase 3: Admin & Frontend
9. Enhance admin panel with character controls and mode switching
10. Build live dashboard with multi-character display
11. Add topic injection and live transcript

### Phase 4: Integrations & Polish
12. Port integrations (pump.fun, birdeye, twitter) as event sources
13. Add conversation mode auto-switching
14. Performance tuning (response latency, audio quality)

## Technical Challenges
- **Latency**: 5 characters means 5× LLM calls during active discussion. Director must be smart about when to involve multiple characters vs just one
- **Audio overlap**: Queue manager must be robust — can't have two characters talking at once in the Space
- **Context size**: Each character needs their own history + shared show context. Token budgets matter
- **Cost**: Multiple LLM calls per audience interaction. Consider using faster/cheaper models for banter and premium models for audience responses

## Validation
- [ ] Bot joins X Space and characters auto-converse
- [ ] Each character has a distinct voice
- [ ] Space speakers trigger character responses
- [ ] Director picks appropriate character for each response
- [ ] Audio queue prevents overlap
- [ ] Admin can switch conversation modes
- [ ] Admin can enable/disable individual characters
- [ ] Dashboard shows live multi-character transcript


