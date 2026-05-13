# Migration Guide: Legacy Code to packages/

## Current Status

The `packages/` directory is the **active codebase** for xspace-agent. All new development should target the packages monorepo:

- `packages/core` - Published as `xspace-agent` on npm (main SDK)
- `packages/server` - Published as `@xspace/server` (admin panel)
- `packages/cli` - Published as `@xspace/cli` (CLI tool)

The legacy code in the root `providers/`, `x-spaces/`, and `src/` directories is retained only for backward compatibility with `server.js`. It will be **removed in v1.0**.

## Legacy Code Locations and Modern Equivalents

### providers/ (LLM, STT, TTS)

| Legacy File | Modern Equivalent | Notes |
|---|---|---|
| `providers/index.js` | `packages/core/src/pipeline/llm.ts` | Provider factory via `createLLM(config)` |
| `providers/claude.js` | `packages/core/src/pipeline/llm.ts` | Claude provider built into the unified LLM factory |
| `providers/groq.js` | `packages/core/src/pipeline/llm.ts` | Groq provider built into the unified LLM factory |
| `providers/openai-chat.js` | `packages/core/src/pipeline/llm.ts` | OpenAI Chat provider built into the unified LLM factory |
| `providers/openai-realtime.js` | `packages/core/src/pipeline/llm.ts` | OpenAI Realtime provider built into the unified LLM factory |
| `providers/stt.js` | `packages/core/src/pipeline/stt.ts` | STT provider factory via `createSTT(config)` |
| `providers/tts.js` | `packages/core/src/pipeline/tts.ts` | TTS provider factory via `createTTS(config)` |

Key improvements in the new provider system:
- All providers implement standardized interfaces (`LLMProvider`, `STTProvider`, `TTSProvider`)
- Built-in health checks via `checkHealth()`
- Metrics collection via `getMetrics()` (request counts, latency, success rates)
- Cost estimation via `estimateCost()`
- Intelligent routing across multiple providers via `ProviderRouter`

### x-spaces/ (Browser Automation)

| Legacy File | Modern Equivalent | Notes |
|---|---|---|
| `x-spaces/index.js` | `packages/core/src/agent.ts` | `XSpaceAgent` class orchestrates the full lifecycle |
| `x-spaces/browser.js` | `packages/core/src/browser/lifecycle.ts` | `BrowserLifecycle` manages Puppeteer launch, login, join/leave |
| `x-spaces/auth.js` | `packages/core/src/browser/lifecycle.ts` | Authentication is integrated into `BrowserLifecycle` |
| `x-spaces/selectors.js` | `packages/core/src/browser/selectors.ts` | Self-healing selectors with multiple fallback strategies |
| `x-spaces/space-ui.js` | `packages/core/src/browser/selector-engine.ts` | `SelectorEngine` with CSS, text, and aria selector strategies |
| `x-spaces/audio-bridge.js` | `packages/core/src/audio/pipeline.ts` | `AudioPipeline` with VAD, silence detection, and encoding |

Key improvements in the new browser system:
- Self-healing `SelectorEngine` that tries CSS, text, and aria strategies automatically
- Finite state machine for agent lifecycle (`idle` -> `launching` -> `authenticating` -> `joining` -> `listening` -> `speaking` -> `leaving` -> `stopped`)
- Middleware pipeline with six interception points (`before:stt`, `after:stt`, `before:llm`, `after:llm`, `before:tts`, `after:tts`)
- Multi-agent coordination via `AgentTeam`
- Plugin system via `PluginManager`
- Structured error types extending `XSpaceError` with codes, hints, and docs URLs

### src/ (Legacy Server)

| Legacy File | Modern Equivalent | Notes |
|---|---|---|
| `src/server/index.ts` | `packages/server/src/` | Express + Socket.IO admin panel |
| `src/server/routes.ts` | `packages/server/src/` | API routes with Zod validation |
| `src/server/middleware/` | `packages/server/src/` | Auth, security, rate limiting middleware |
| `server.js` | `packages/server/src/` | JavaScript entry point (do not modify) |

## Timeline

| Milestone | What Happens |
|---|---|
| **Now** | Legacy code has deprecation notices. All new features go into `packages/`. |
| **Pre-v1.0** | Final migration of any remaining `src/` server functionality into `packages/server`. |
| **v1.0** | `providers/`, `x-spaces/`, `src/`, and `server.js` are removed. Only `packages/` remains. |

## How to Use the New Packages

### Install the SDK

```bash
npm install xspace-agent
```

### Basic Usage

```typescript
import { XSpaceAgent } from 'xspace-agent';

const agent = new XSpaceAgent({
  llm: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY },
  stt: { provider: 'groq', apiKey: process.env.GROQ_API_KEY },
  tts: { provider: 'elevenlabs', apiKey: process.env.ELEVENLABS_API_KEY },
  browser: { headless: true },
  auth: { authToken: process.env.X_AUTH_TOKEN, ct0: process.env.X_CT0 }
});

await agent.join('https://x.com/i/spaces/...');
```

### Multi-Agent Setup

```typescript
import { AgentTeam } from 'xspace-agent';

const team = new AgentTeam({
  agents: [
    { name: 'Alice', prompt: '...', voice: 'nova' },
    { name: 'Bob', prompt: '...', voice: 'onyx' }
  ],
  // shared browser session
  auth: { authToken: process.env.X_AUTH_TOKEN, ct0: process.env.X_CT0 }
});

await team.start('https://x.com/i/spaces/...');
```

### CLI

```bash
npm install -g @xspace/cli

xspace-agent init        # Scaffold a new project
xspace-agent auth        # Set up X authentication
xspace-agent join <url>  # Join a Space
xspace-agent start       # Start from config file
xspace-agent dashboard   # Open admin panel
```

### Admin Panel

```bash
npm install @xspace/server

# Start the server (default port 3000)
ADMIN_API_KEY=your-key npx xspace-server
```

## Migration Checklist

If you have code that imports from the legacy directories, update your imports:

- [ ] Replace `require("./providers/...")` with `import { createLLM, createSTT, createTTS } from 'xspace-agent'`
- [ ] Replace `require("./x-spaces/...")` with `import { XSpaceAgent } from 'xspace-agent'`
- [ ] Replace manual browser/audio setup with `XSpaceAgent` configuration object
- [ ] Replace ad-hoc state tracking with FSM events (`agent.on('state:change', ...)`)
- [ ] Replace direct selector usage with `SelectorEngine` (handles fallbacks automatically)
- [ ] Update error handling to catch typed `XSpaceError` subclasses

See the `examples/` directory for 10 runnable example projects demonstrating the new API.


