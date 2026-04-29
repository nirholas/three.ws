# Prompt: X Space Agent — Standalone Improvements

## Context
This is the standalone X Space agent system. It uses Puppeteer to join X/Twitter Spaces, captures audio from speakers, runs it through an AI pipeline (STT → LLM → TTS), and speaks back. It has an admin control panel and supports multiple AI providers.

## Current State
- server.js: 504 lines — Express + Socket.IO server with /space namespace
- x-spaces/: Puppeteer automation (browser, auth, space-ui, audio-bridge, selectors)
- providers/: Pluggable AI (openai-realtime, openai-chat, groq, claude, stt, tts)
- public/: Admin panel, dashboard, agent pages, provider JS

## Improvements to Implement

### 1. Code Modularization — Break Up server.js
server.js is still a 500-line monolith mixing routing, state, Socket.IO handlers, and business logic.

**Split into:**
```
server.js              → slim entry point (~50 lines): Express setup, route mounting, server.listen
routes/
  index.js             → Express route handlers (/, /admin, /agent1, /agent2, /config, /session/:id)
socket/
  space-handlers.js    → /space namespace Socket.IO event handlers
  turn-manager.js      → requestTurn(), releaseTurn(), turn queue logic
state/
  agent-state.js       → spaceState object, agent prompts, voice configs
pipeline/
  llm-handler.js       → handleLLMResponse() and audio pipeline orchestration
```

**Rules:**
- Each module exports a single clear interface
- State is passed by reference, not duplicated
- Socket.IO `io` instance is passed to handlers, not imported globally
- No circular dependencies

### 2. Error Recovery & Resilience
Currently if the browser crashes or X kicks the bot, it just dies.

**Add:**
- **Auto-reconnect on browser crash**: Detect Puppeteer disconnect event, auto-restart browser and rejoin Space
- **Space ejection detection**: Monitor for "you've been removed" or "Space ended" DOM states in space-ui.js, emit proper status events
- **Audio pipeline timeout**: If STT/LLM/TTS takes >15s, cancel and release turn instead of blocking forever
- **Graceful shutdown**: On SIGTERM/SIGINT, leave Space cleanly, close browser, close server

### 3. Conversation Quality
- **Conversation history management**: Currently openai-chat and groq keep last 20 messages. Make this configurable via env var `MAX_HISTORY` and add a token-counting approach instead of fixed message count
- **Context injection**: Allow injecting context documents (project info, talking points) that persist across conversations. Load from a `context/` directory or via admin panel
- **Speaker identification**: Currently all speakers are "User". Use X Space DOM to extract speaker names and include them in transcription: "(@username): what they said"

### 4. Audio Pipeline Improvements
- **Noise gate**: Add amplitude threshold to audio-bridge.js to filter background noise before sending to STT
- **Audio level normalization**: Normalize captured audio volume before STT to improve transcription accuracy
- **Configurable VAD**: Make silence threshold (currently 1.5s) and amplitude threshold configurable via env vars
- **Overlap prevention**: If the bot is currently speaking and someone else starts talking, optionally interrupt (configurable behavior)

### 5. Rate Limiting & Safety
- **LLM rate limiting**: Track API calls per minute, queue overflow requests instead of firing all at once
- **Response length control**: Configurable max response length (tokens) per provider
- **Content filtering**: Optional blocklist of topics the agent should avoid discussing
- **Cost tracking**: Log estimated API cost per response (tokens × rate), expose via admin panel

### 6. Logging & Observability
- **Structured logging**: Replace console.log with a proper logger (pino or winston) with log levels
- **Request ID tracking**: Each audio chunk → STT → LLM → TTS cycle gets a unique ID for tracing
- **Performance metrics**: Track and expose via /metrics endpoint:
  - STT latency (ms)
  - LLM latency (ms)
  - TTS latency (ms)
  - End-to-end response time
  - Total responses served
  - Current turn queue depth

## Implementation Order
1. Code modularization (foundation for everything else)
2. Error recovery (most impactful for reliability)
3. Logging (needed to debug the rest)
4. Conversation quality (user-facing improvement)
5. Audio pipeline (refinement)
6. Rate limiting (polish)

## Validation
- [ ] server.js is <60 lines
- [ ] Bot auto-reconnects when browser crashes (test by killing Puppeteer process)
- [ ] Structured logs with levels work
- [ ] Speaker names appear in transcriptions
- [ ] Graceful shutdown cleans up properly


