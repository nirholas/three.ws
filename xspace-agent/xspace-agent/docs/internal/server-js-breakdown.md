> **Internal Planning Document** — Not part of the public documentation.

> **Outdated**: This describes the legacy monolithic `server.js`. The codebase has been refactored into a monorepo. See [architecture-overview.md](./architecture-overview.md) for current architecture.

# server.js — Complete Line-by-Line Breakdown

The server is a 944-line monolith. Here's every section:

---

## Lines 1-58: Imports & Config

```
1-8:     Import dotenv, express, http, socket.io, OpenAI, axios
9-14:    Import internal modules (pumpFunChat, providers, stt, tts, x-spaces)
17-21:   Import Talky data services (birdeye, pumpPortal, pumpFunChat, twitter)
23-41:   Read env vars → PORT, CONTRACT, PROJECT_NAME, BUY_LINK, X_LINK, etc.
43-48:   Talky-specific config (BIRDEYE_API_KEY, OPENROUTER_API_KEY, VOICE keys)
49-55:   Create OpenRouter client and OpenAI client (talkyAI = openrouter || openai)
61:      Create AI provider instance for X Space agents
```

**Key point:** `talkyAI` (OpenRouter/OpenAI) is used ONLY for the Talky show. The X Space agents use `provider` (from `createProvider()`).

---

## Lines 63-93: Express App Setup

```
64-71:   Create Express app, HTTP server, Socket.IO with CORS
73:      Serve static files from public/
74:      Parse JSON bodies
76-80:   Routes: /, /talky, /agent1, /agent2, /admin
82-93:   GET /config — returns feature flags, provider type, TTS mode
95-99:   GET /state — returns agent states, current turn, last 50 messages
101-112: GET /session/:agentId — creates OpenAI Realtime session (WebRTC only)
```

---

## Lines 114-176: X Space State & Prompts

```
117:     Create Socket.IO namespace /space
119-128: spaceState object — tracks 2 agents, turn queue, messages, processing flag
130-169: baseInfo prompt — personality instructions for agents
171-174: spacePrompts — per-agent personality (agent 0 = louder, agent 1 = chill)
176:     spaceVoices — agent 0 = "verse", agent 1 = "sage" (OpenAI Realtime voices)
```

---

## Lines 178-208: Turn Management

```
178-185: isWallet() / shortenNick() — helpers for wallet address display
187-193: broadcastSpaceState() — emit state to all /space clients
195-208: requestTurn(agentId) — acquire speaking turn or queue
210-226: releaseTurn(agentId) — release turn, grant to next in queue (500ms delay)
```

**Turn system:** Only one agent can speak at a time. Uses a queue. When agent finishes, next in queue gets the turn after 500ms.

---

## Lines 228-269: LLM Response Handler (Socket Provider)

```
228-269: handleLLMResponse(socket, agentId, userText)
         - Requests turn
         - Streams LLM response via provider.streamResponse()
         - Emits textDelta events as tokens arrive
         - On complete: stores message, emits textComplete
         - Calls tts.synthesize() for audio
         - Sends audio as base64 via ttsAudio event
         - Falls back to ttsBrowser if TTS fails
         - Always releases turn in finally block
```

This function is the core pipeline for non-WebRTC providers (Claude, Groq, OpenAI Chat).

---

## Lines 271-396: Socket.IO /space Event Handlers

```
271-279: connection — send initial state and message history
281-300: agentConnect / agentDisconnect — agent lifecycle
302-308: statusChange — update agent status
310-315: requestTurn / releaseTurn — manual turn control
317-332: textDelta / textComplete — forward transcription to all clients
334-362: audioData — receive mic audio from browser agent, STT → handleLLMResponse
364-380: userMessage — web chat → route to agent (socket mode: handleLLMResponse, webrtc: textToAgent)
376-380: textToAgentDirect — direct message to specific agent (socket mode only)
382:     audioLevel — forward audio levels for UI meters
384-396: disconnect — cleanup agent state on socket disconnect
```

---

## Lines 398-419: PumpFun Chat Integration (X Space)

```
398-418: If LIVE_CHAT && CONTRACT, connect to pump.fun chat
         - On chatMessage: push to spaceState, emit to /space
         - If socket provider: handleLLMResponse() to first connected agent
         - If webrtc: emit textToAgent for browser-side processing
419:     Forward pump.fun connection status to /space clients
```

---

## Lines 421-545: X Spaces Puppeteer Integration

```
424:     X_SPACES_ENABLED flag from env
429-453: xSpaces.emitter "status" handler
         - When "speaking-in-space": generates intro line, TTS, speaks in Space
455-458: xSpaces.emitter "error" handler
460-462: 2FA handler — forwards to admin panel
464-514: xSpaces.emitter "transcription" handler (CORE LOOP):
         - Receives transcribed text from Space audio
         - Creates user message, pushes to spaceState
         - Calls provider.streamResponse() for AI reply
         - TTS → xSpaces.speakInSpace() to inject audio back
517-536: Socket.IO events for X Spaces admin control:
         - xspace:start — launch browser + login
         - xspace:join — join a Space URL
         - xspace:leave — leave current Space
         - xspace:stop — stop everything
         - xspace:status — get current status
         - xspace:2fa — submit 2FA code
538-544: Auto-start if X_USERNAME + X_PASSWORD set
```

---

## Lines 547-943: Talky Show System (NOT for standalone)

```
550:     Create /talky namespace
552-573: Spam filter keywords and sanitization helpers
575-593: aiCast array — 5 AI characters with names, models, ASCII faces, voice IDs
594-596: Talky state variables (history, token data, event queue, etc.)
598-658: /talky connection handler — init, chat messages, rate limiting
660-791: processTalkyEvent() — AI director picks speaker/target, generates roast, TTS
793-821: getTalkyMP3Duration() — parse MP3 headers for timing
823-845: sendTalkyAudio() — ElevenLabs TTS + broadcast
847-877: Event queue processing and countdown timer
879-929: startTalkyServices() — connect Birdeye, PumpPortal, Pump.fun, Twitter feeds
932-943: Server startup — listen on PORT, print URLs, start Talky
```


