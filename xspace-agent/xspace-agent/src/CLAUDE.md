# CLAUDE.md — src/ (Legacy Server)

This is the **original monolithic implementation** of the X Space Agent system. It runs via `npm run dev` (TypeScript with tsx) or `npm run start:legacy` (compiled server.js).

**Status**: Being migrated into `packages/`. For new features, prefer `packages/core/`. This code still works and powers the CLI `start` command.

## Commands

```bash
npm run dev          # tsx watch src/server/index.ts
npm run start:legacy # node server.js
```

## Architecture

```
src/
├── types.ts                    Core types: Agent, Message, SpaceState, Provider, TypedEmitter
│
├── server/
│   ├── index.ts                Express + Socket.IO /space namespace, X Spaces integration toggle
│   ├── routes.ts               GET /, /config, /state, /session/:agentId
│   ├── socket-handlers.ts      All socket events: agentConnect, audioData, userMessage, xspace:*
│   ├── turn-manager.ts         Queue-based turn management (requestTurn/releaseTurn/broadcastState)
│   ├── agent-registry.ts       2 hardcoded agents (Agent Zero and Agent One), prompts, voice IDs
│   └── providers/
│       ├── index.ts            createProvider() factory (env-driven: AI_PROVIDER)
│       ├── claude.ts           Anthropic SDK streaming, 20-message history per agent
│       ├── openai-chat.ts      OpenAI Chat Completions streaming
│       ├── openai-realtime.ts  OpenAI Realtime WebRTC session creation
│       ├── groq.ts             Groq API streaming
│       ├── tts.ts              TTS: ElevenLabs > OpenAI > browser fallback chain
│       └── stt.ts              STT: Groq Whisper > OpenAI Whisper fallback
│
├── client/
│   ├── core.ts                 AgentCommon class — Socket.IO client, Web Audio API, DOM, turn management
│   ├── bootstrap.ts            Client init: load /config → detect provider → init webrtc or streaming
│   └── providers/
│       ├── streaming.ts        Socket.IO streaming provider (audioData → STT → LLM → TTS)
│       └── webrtc.ts           OpenAI Realtime WebRTC provider (direct RTCPeerConnection)
│
├── browser/
│   ├── orchestrator.ts         XSpacesEmitter — Puppeteer state machine for X Spaces
│   ├── launcher.ts             Browser launch with stealth plugin
│   ├── auth.ts                 X login flow (cookie or form + 2FA)
│   ├── space-ui.ts             DOM interactions: join, request speaker, inject audio
│   └── selectors.ts            CSS selectors for X Space UI elements
│
└── audio/
    └── bridge.ts               RTCPeerConnection audio hooks, PCM capture, WAV encoding, audio injection
```

## Key Differences from packages/core

| Aspect | src/ (legacy) | packages/core/ |
|--------|--------------|----------------|
| Agents | 2 hardcoded (IDs 0, 1) | Configurable via AgentConfig |
| Providers | env-var factory, module-level | Factory functions with typed interfaces |
| History | 20 messages per agent in provider | ConversationManager with token windowing |
| FSM | Ad-hoc status strings | Formal StateMachine with typed states/events |
| Selectors | Simple CSS strings | SelectorEngine with multi-strategy fallback |
| Observability | console.log | Pino structured logging, metrics, Socket transport |
| Testing | None | Vitest with coverage |

## Data Flow

1. Client connects to Socket.IO `/space` namespace
2. `agentConnect` registers the agent (0 or 1)
3. `audioData` event → STT transcription → LLM streaming → TTS synthesis → `ttsAudio` event back
4. OR `userMessage` event → LLM streaming → TTS → `ttsAudio`
5. Turn management ensures one agent speaks at a time

For X Spaces integration: the `XSpacesEmitter` orchestrator manages Puppeteer browser → captures Space audio → feeds into the same STT → LLM → TTS pipeline → injects audio back into Space.


