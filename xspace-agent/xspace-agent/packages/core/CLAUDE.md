# CLAUDE.md — packages/core (xspace-agent SDK)

This is the main SDK package published as `xspace-agent` on npm. It provides everything needed to build AI voice agents for X Spaces.

## Commands

```bash
npm run build        # tsc → dist/
npm run dev          # tsc --watch
npm run test         # vitest run
npm run test:watch   # vitest (watch mode)
npm run test:coverage # vitest run --coverage
npm run clean        # rm -rf dist
```

## Module Map

```
src/
├── index.ts              Public API barrel export (all SDK exports)
├── agent.ts              XSpaceAgent — main class, orchestrates all subsystems
├── team.ts               AgentTeam — multi-agent coordination on shared browser session
├── types.ts              All public type definitions and interfaces
├── errors.ts             XSpaceError hierarchy (8 error classes with codes + hints)
├── config.ts             Zod schema validation for AgentConfig
├── conversation.ts       ConversationManager — message history with token windowing
├── health.ts             HealthMonitor — periodic health checks for all providers
├── logger.ts             Logger interface (legacy, prefer observability/ for new code)
│
├── audio/
│   ├── pipeline.ts       AudioPipeline — capture → VAD → silence → encode chain
│   ├── bridge.ts         Low-level audio: pcmChunksToWav(), mp3ToPcmFloat32(), injectAudio()
│   ├── vad.ts            VoiceActivityDetector — energy-based speech detection
│   ├── pcm.ts            PCM utilities
│   ├── gain-normalizer.ts  Audio gain normalization
│   └── echo-canceller.ts  Echo suppression
│
├── browser/
│   ├── lifecycle.ts      BrowserLifecycle — launch → login → join → leave → stop
│   ├── launcher.ts       BrowserManager — Puppeteer launch with stealth plugin
│   ├── auth.ts           X login flow (cookie auth or form login + 2FA)
│   ├── space-ui.ts       DOM interaction: click buttons, join space, request speaker
│   ├── selector-engine.ts SelectorEngine — self-healing selectors (CSS → text → aria fallback)
│   ├── selectors.ts      SELECTOR_DEFINITIONS — all X Space UI element selectors
│   ├── observer.ts       DOMObserver — CDP-based DOM change monitoring
│   └── secure-cookie-store.ts  AES-encrypted cookie persistence
│
├── pipeline/
│   ├── llm.ts            createLLM() factory — OpenAI, Claude, Groq, Custom
│   ├── stt.ts            createSTT() factory — Groq Whisper, OpenAI Whisper
│   ├── tts.ts            createTTS() factory — ElevenLabs, OpenAI TTS, Browser
│   ├── cache.ts          Response caching for repeated queries
│   └── types.ts          Internal provider interface types
│
├── providers/
│   ├── router.ts         ProviderRouter — intelligent routing across multiple LLM providers
│   ├── cost-tracker.ts   CostTracker — per-provider USD cost monitoring
│   ├── health-monitor.ts ProviderHealthMonitor — periodic health checks + events
│   ├── custom.ts         Custom provider adapter
│   └── types.ts          RoutableProvider, RoutingStrategy, CostEntry, etc.
│
├── intelligence/
│   ├── sentiment.ts      detectSentiment() — rule-based sentiment classification
│   ├── speaker-id.ts     SpeakerIdentifier — attribute transcriptions to speakers
│   ├── topic-tracker.ts  TopicTracker — extract and track conversation topics
│   ├── context-manager.ts ContextManager — conversation context windowing
│   ├── prompt-builder.ts PromptBuilder — dynamic system prompt construction
│   └── persistence.ts    ConversationStore — JSON file-based conversation storage
│
├── turns/
│   ├── coordinator.ts    TurnCoordinator — multi-agent turn orchestration
│   ├── decision-engine.ts DecisionEngine — should-I-respond logic
│   ├── interruption.ts   InterruptionHandler — handle overlapping speech
│   ├── adaptive-silence.ts AdaptiveSilenceDetector — dynamic silence thresholds
│   └── pacing.ts         ResponsePacer — response timing control
│
├── fsm/
│   ├── machine.ts        StateMachine<Context, Event> — generic FSM engine
│   ├── agent-machine.ts  Agent FSM: idle→launching→authenticating→joining→listening→speaking→leaving→stopped
│   └── team-machine.ts   Team FSM: idle→starting→active→stopping→stopped
│
├── plugins/
│   ├── manager.ts        PluginManager — lifecycle hooks for agent extensions
│   └── types.ts          Plugin, PluginContext, AudioFrame interfaces
│
└── observability/
    ├── index.ts           Re-exports all observability utilities
    ├── logger.ts          createLogger() — Pino-based structured logging with redaction
    ├── metrics.ts         MetricsCollector — counters, histograms, gauges
    └── log-transport.ts   SocketLogTransport — forward logs over Socket.IO
```

## Key Interfaces

**Provider contracts** (in `types.ts`) — every provider implements:
- Core operation: `streamResponse()` / `transcribe()` / `synthesize()`
- `checkHealth()` → `{ ok, latencyMs, error? }`
- `getMetrics()` → `{ requestCount, successCount, errorCount, avgLatencyMs, ... }`
- `estimateCost(tokens)` → USD number

**Agent lifecycle events** (in `types.ts`):
- `transcription` — speech transcribed from Space
- `response` — agent generated and spoke
- `status` — FSM state changed
- `error` — something went wrong
- `space-ended` — Space ended
- `speaker-joined` / `speaker-left`
- `turn:decision` / `turn:interrupted` / `turn:deferred`
- `audio:*` — low-level audio observability events

## Testing

Tests live in `src/__tests__/` and `tests/`:
- `providers.test.ts` — provider factories and interface compliance
- `observability.test.ts` — logger and metrics
- `selector-engine.test.ts` — selector self-healing strategies
- `intelligence.test.ts` — sentiment, speaker ID, topic tracking
- `e2e/` — end-to-end tests requiring real API keys (CI only)

Coverage config in `vitest.config.ts`: v8 provider, excludes `types.ts` and `browser/`.

## Patterns

1. **Adding a new LLM provider**: Implement `LLMProvider` interface, add case to `createLLM()` in `pipeline/llm.ts`.
2. **Adding a new selector**: Add to `SELECTOR_DEFINITIONS` in `browser/selectors.ts` with multiple strategies (CSS, text, aria).
3. **Adding intelligence**: New file in `intelligence/`, wire into `XSpaceAgent.agent.ts`.
4. **Adding a plugin**: Implement `Plugin` interface from `plugins/types.ts`.
5. **Extending the FSM**: Add states/transitions in `fsm/agent-machine.ts` or `fsm/team-machine.ts`.


