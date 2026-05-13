> **Internal Planning Document** — Not part of the public documentation.

> **Outdated**: The Talky Show system has been removed from this project. See [architecture-overview.md](./architecture-overview.md) for current architecture.

# Prompt: Talky Show — Standalone Rebuild

## Context
The Talky show was an AI comedy show where 5 AI characters (Grok, GPT, Deepseek, Claude, Gemini) roast each other in a retro CRT terminal web interface. It was previously embedded in the same monolith as the X Space agent. This prompt defines rebuilding it as a standalone project.

## What Talky Does
- 5 AI characters auto-converse every 10 seconds
- A "Director" AI picks who speaks and who they target
- Users can send chat messages that characters respond to
- Each character has a distinct ElevenLabs voice
- Optional integrations: pump.fun live chat, Solana token trades, Twitter reply monitoring
- Retro MS-DOS terminal aesthetic with ASCII character faces

## New Project Structure
```
talky-show/
├── server.js                    ← Express + Socket.IO server
├── package.json
├── .env.example
├── .gitignore
├── Procfile
├── README.md
│
├── cast/
│   ├── index.js                 ← Cast definitions (characters, voices, models)
│   ├── director.js              ← Director AI that picks speakers/targets
│   └── characters.json          ← Character configs (name, model, personality, voiceId, ascii art)
│
├── conversation/
│   ├── engine.js                ← Core conversation loop (event queue, 10s timer, priority)
│   ├── generator.js             ← LLM response generation (chat reply vs auto-converse)
│   └── history.js               ← Conversation history management
│
├── audio/
│   ├── tts.js                   ← ElevenLabs TTS with per-character voice
│   └── mp3-utils.js             ← MP3 duration parsing
│
├── integrations/                ← Optional, each toggleable via env vars
│   ├── pump-fun-chat.js         ← Pump.fun live chat feed
│   ├── pump-portal.js           ← Solana trade feed
│   ├── birdeye.js               ← Token price/market cap feed
│   └── twitter.js               ← Twitter reply monitoring
│
├── public/
│   ├── index.html               ← Main viewer page
│   ├── style.css                ← CRT terminal styles
│   └── app.js                   ← Frontend: Socket.IO, ASCII faces, typewriter, audio
│
└── docs/
    └── architecture.md
```

## Key Design Decisions

### Character System
- Characters defined in `characters.json` so users can customize without touching code
- Each character has: name, model, personality prompt, ASCII art, ElevenLabs voiceId, accent color
- Adding a new character = adding a JSON entry (no code changes)

### Conversation Engine
- Event-driven queue with priority (user messages > external feeds > auto-conversation)
- Configurable idle timer (default 10s) before auto-conversation triggers
- Rate limiting per user (SPAM_SECONDS)
- HTML sanitization on all user input

### Integration System
- Each integration is a self-contained module that emits events
- Enabled/disabled via env vars (LIVE_CHAT, LIVE_TRADE, TWEET_CHECK, etc.)
- Server subscribes to integration events and feeds them into conversation engine
- Integrations auto-reconnect on disconnect

## Environment Variables
```env
# Server
PORT=3000

# AI
OPENROUTER_API_KEY=           # OpenRouter for character responses
AI_MODEL=gpt-4o-mini          # Model for all characters

# Voice
ELEVENLABS_API_KEY=           # ElevenLabs TTS
VOICE_GROK=                   # Per-character voice IDs
VOICE_GPT=
VOICE_DEEPSEEK=
VOICE_CLAUDE=
VOICE_GEMINI=

# Project Info
PROJECT_NAME=
CONTRACT_ADDRESS=
TOKEN_CHAIN=Solana

# Feature Flags
LIVE_CHAT=false               # Pump.fun chat integration
LIVE_TRADE=false              # Trade ticker
LIVE_MC=false                 # Market cap display
TWEET_CHECK=false             # Twitter reply monitoring
VOICE_STATUS=false            # Enable/disable TTS

# Integration Keys (only needed if features enabled)
BIRDEYE_API_KEY=
PUMPORTAL_API_KEY=
APIFY_TOKEN=
TARGET_TWEET=
```

## Improvements Over Original
1. **Modular architecture** — no 900-line monolith
2. **Configurable characters** — JSON-based, not hardcoded
3. **Clean integration system** — each data source is a pluggable module
4. **Better error handling** — integrations fail independently, don't crash the show
5. **Proper event system** — Node EventEmitter with typed events

## Build Steps
1. Set up project skeleton (package.json, server.js, routes)
2. Port character definitions to characters.json
3. Build conversation engine (extract from original server.js lines 660-883)
4. Build TTS module (extract from original server.js lines 793-845)
5. Port each integration as standalone module
6. Port frontend (talky.html/js/css → clean single-page app)
7. Add .env.example and README

## Validation
- [ ] `npm start` launches server, serves frontend
- [ ] Characters auto-converse every 10 seconds
- [ ] User chat triggers character response
- [ ] Each character has distinct TTS voice
- [ ] Integrations can be toggled on/off without errors
- [ ] Adding a new character via JSON works without code changes


