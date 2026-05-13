---
description: "Use when editing the core xspace-agent SDK — agent class, audio pipeline, browser automation, FSM, providers, intelligence, turns, middleware, plugins."
applyTo: "packages/core/**"
---
# Core SDK (packages/core/)

Published as `xspace-agent` on npm. See `packages/core/CLAUDE.md` for the full module map.

## Key Classes

| Class | File | Purpose |
|-------|------|---------|
| `XSpaceAgent` | `src/agent.ts` | Main entry point, orchestrates all subsystems |
| `AgentTeam` | `src/team.ts` | Multi-agent coordination on shared browser |
| `BrowserLifecycle` | `src/browser/lifecycle.ts` | Puppeteer launch → login → join → leave → stop |
| `AudioPipeline` | `src/audio/pipeline.ts` | Capture → VAD → silence → encode chain |
| `StateMachine` | `src/fsm/machine.ts` | Generic FSM engine for agent/team lifecycle |
| `SelectorEngine` | `src/browser/selector-engine.ts` | Self-healing CSS/text/aria selector strategies |
| `ProviderRouter` | `src/providers/router.ts` | Multi-provider LLM routing |

## Patterns

- **Provider interfaces**: `LLMProvider`, `STTProvider`, `TTSProvider` in `src/types.ts` — must implement `streamResponse()`/`transcribe()`/`synthesize()`, `checkHealth()`, `getMetrics()`, `estimateCost()`
- **Provider factories**: `createLLM()`, `createSTT()`, `createTTS()` in `src/pipeline/`
- **Error classes**: All extend `XSpaceError` in `src/errors.ts` with `code`, `message`, `hint`, `docsUrl`
- **FSM transitions**: `idle→launching→authenticating→joining→listening→speaking→leaving→stopped`
- **Middleware hooks**: `before:stt → after:stt → before:llm → after:llm → before:tts → after:tts`
- **Config validation**: Zod schemas in `src/config.ts`

## Rules

- Never hardcode X Space CSS selectors — add alternatives to `SelectorEngine`
- Never bypass the FSM for agent state transitions — use `StateMachine`
- All new errors must extend `XSpaceError` with a code and hint
- New providers must implement the full interface including health/metrics/cost
- No database dependencies — persistence is file-based (JSON + gzip)

## Commands

```bash
cd packages/core && pnpm test          # vitest run
cd packages/core && pnpm build         # tsc → dist/
cd packages/core && pnpm test:coverage # vitest with coverage
```


