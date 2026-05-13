# CLAUDE.md — agent-voice-chat/

Standalone voice chat agent platform with multi-room support, memory/RAG, knowledge base, and client framework packages. More feature-rich than the legacy `src/` server but operates independently.

## Entry Point

```bash
node server.js  # Main entry — Express + Socket.IO + full middleware stack
```

## Architecture

```
server.js                       Main server (~1000 lines): Express, Socket.IO, circuit breakers, room/agent setup
agent-registry.js               Flexible agent definitions (JSON/YAML config, string IDs, swappable personalities)
room-manager.js                 Multi-room support: per-room state, agents, turn queue, TTL cleanup, max 50 participants

lib/
├── memory-store.js             Episodic + semantic memory with embedding vectors, per-user profiles, 1000-item max
├── conversation-store.js       Active cache + .json.gz compressed archive, metadata-only mode
├── knowledge-base.js           Document chunking (500 chars, 50 overlap) + embedding retrieval (top 3 chunks)
├── context-injector.js         Combines memory + knowledge into LLM context at injection points
└── embeddings.js               Embedding generation for vector similarity search

providers/
├── index.js                    Provider factory with fallback chain
├── claude.js                   Anthropic SDK
├── openai-chat.js              OpenAI Chat API
├── openai-realtime.js          OpenAI WebRTC
├── groq.js                     Groq API
├── tts.js                      TTS: ElevenLabs, OpenAI, Chatterbox, Piper, Browser
└── stt.js                      STT: Groq Whisper, OpenAI Whisper

src/server/
├── socket-handler.js           Socket.IO events (new spec + legacy compat)
├── config.js                   Zod env validation
├── constants.js                Shared constants
├── health.js                   Health checks
├── metrics.js                  Metrics tracking
├── errors.js                   AppError hierarchy: NotFoundError, ConflictError, ValidationError, ProviderError
├── logger.js                   Pino logger with redaction (auth, cookies, tokens, audio)
├── routes/
│   ├── agents.js               CRUD + start/stop agents
│   ├── agent-control.js        speak, join, leave commands
│   ├── rooms.js                Room CRUD
│   ├── conversations.js        Conversation listing + archival
│   ├── personalities.js        Personality presets CRUD
│   ├── memory.js               Memory search + add + delete
│   ├── knowledge.js            Knowledge base search + index + stats
│   └── system.js               Config, health, providers
└── middleware/
    ├── auth.js                 Bearer token auth (no-op if API_KEY not set)
    ├── rate-limit.js           express-rate-limit
    ├── sanitize.js             Input sanitization
    └── security.js             Helmet, CORS

packages/                       Client framework packages
├── core/                       @agent-voice-chat/core — base client library
├── react/                      @agent-voice-chat/react — React hooks + components
├── vue/                        @agent-voice-chat/vue — Vue composables + components
└── widget/                     @agent-voice-chat/widget — standalone embeddable widget

tests/
├── helpers/                    Test factories, mock providers, Socket.IO helpers
├── unit/                       memory-store, knowledge-base, embeddings, middleware
└── integration/                API agents, conversations, system, socket, provider failures
```

## OpenAPI Spec

Full spec at `openapi.json` (OpenAPI 3.0.3). Key endpoint groups:
- `/api/agents` — Agent lifecycle and control
- `/api/rooms` — Multi-room management
- `/api/conversations` — History and archival
- `/api/memory` — Episodic/semantic memory with vector search
- `/api/knowledge` — Document RAG
- `/api/personalities` — Swappable personality presets
- `/api/health`, `/api/config`, `/api/providers` — System info

## Key Differences from packages/core

- **Multi-room**: RoomManager supports concurrent rooms with TTL cleanup (vs single Space in core)
- **Memory + RAG**: Embedding-based semantic search, user profiles, knowledge base (core has simpler ConversationStore)
- **Circuit breakers**: Per-provider circuit breakers for resilience
- **Client packages**: React, Vue, and widget packages for embedding
- **Agent flexibility**: String IDs, YAML config, swappable personalities (vs typed AgentConfig in core)
- **JavaScript**: This module is plain JavaScript (not TypeScript)

## Testing

```bash
npx vitest run                    # All tests
npx vitest run --coverage         # With coverage (80% thresholds)
```

Uses vitest with custom helpers: `createTestApp()`, `createTestServer()`, `createConnectedClient()`, mock providers.
