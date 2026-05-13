<p align="center">  
  <img src="public/images/logo.svg" width="120" alt="X Space Agent" /> 
</p>

<h1 align="center">X Space Agent</h1>
<p align="center">
  <b>AI agents that join and talk in X/Twitter Spaces</b>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#project-structure">Structure</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#examples">Examples</a> •
  <a href="docs/">Docs</a> •
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

<p align="center">
  <img src="docs/assets/hero.svg" alt="X Space Agent — Multi-agent AI voice conversations" width="800">
  <br>
  <em>Multi-agent AI voice conversations in X/Twitter Spaces — real-time transcription, LLM responses, and voice synthesis</em>
</p>

## What is this?

X Space Agent is a TypeScript SDK that lets you build **AI agents that autonomously join, listen, and speak in X/Twitter Spaces**. Connect any LLM, any voice provider, and ship in minutes. No Twitter API approval needed.

```typescript
import { XSpaceAgent } from 'xspace-agent'

const agent = new XSpaceAgent({
  auth: { token: process.env.X_AUTH_TOKEN!, ct0: process.env.X_CT0! },
  ai: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY! },
})

agent.on('transcription', ({ text }) => console.log('Heard:', text))
agent.on('response', ({ text }) => console.log('Said:', text))

await agent.join('https://x.com/i/spaces/YOUR_SPACE_ID')
```

Or skip the code entirely with the CLI:

```bash
npx xspace-agent join https://x.com/i/spaces/YOUR_SPACE_ID --provider openai
```

## Features

<table>
<tr>
<td align="center">🎤<br><b>Multi-Provider LLM</b><br>OpenAI, Claude, Groq,<br>or any custom API</td>
<td align="center">👥<br><b>Multi-Agent Teams</b><br>Run multiple personalities<br>with turn management</td>
<td align="center">🔧<br><b>Middleware Pipeline</b><br>Hook into STT → LLM → TTS<br>at any stage</td>
</tr>
<tr>
<td align="center">💻<br><b>Zero-Code CLI</b><br><code>npx xspace-agent join &lt;url&gt;</code><br>no SDK needed</td>
<td align="center">📊<br><b>Admin Dashboard</b><br>Web UI to monitor and<br>control live agents</td>
<td align="center">🔷<br><b>TypeScript-First</b><br>Full type safety,<br>autocomplete included</td>
</tr>
</table>

## Requirements

- **Node.js** >= 18 (tested on 18, 20, 22)
- **pnpm** >= 9 (for monorepo development) or npm/yarn for consuming the SDK
- **Chromium** — bundled with Puppeteer, or provide your own via `BROWSER_MODE=connect`
- **X (Twitter) account** — cookie-based auth (`X_AUTH_TOKEN` + `X_CT0`) or username/password
- **At least one AI provider key** — OpenAI, Anthropic, or Groq

## Quick Start

**1. Install**

```bash
npm install xspace-agent
```

**2. Set environment variables**

```bash
# .env
X_AUTH_TOKEN=your_x_auth_token
X_CT0=your_x_ct0_cookie
OPENAI_API_KEY=sk-...
```

> Get `X_AUTH_TOKEN` and `X_CT0` from your browser cookies after logging into X. [Guide →](docs/architecture-overview.md)

**3. Run**

```typescript
import { XSpaceAgent } from 'xspace-agent'

const agent = new XSpaceAgent({
  auth: { token: process.env.X_AUTH_TOKEN!, ct0: process.env.X_CT0! },
  ai: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'gpt-4o',
    systemPrompt: 'You are a helpful AI analyst. Be concise and data-driven.',
  },
  voice: {
    sttProvider: 'deepgram',
    ttsProvider: 'elevenlabs',
    voiceId: 'rachel',
  },
})

agent.on('transcription', ({ text, speaker }) => console.log(`${speaker}: ${text}`))
agent.on('response', ({ text }) => console.log(`Agent: ${text}`))

await agent.join('https://x.com/i/spaces/YOUR_SPACE_ID')
```

Or skip the code entirely with the CLI:

```bash
npx xspace-agent join https://x.com/i/spaces/YOUR_SPACE_ID --provider openai
```

## Deploy

<p>
  <a href="https://railway.app/new/template?template=https://github.com/nirholas/xspace-agent"><img src="https://railway.app/button.svg" alt="Deploy on Railway" height="32" /></a>
  &nbsp;
  <a href="https://render.com/deploy?repo=https://github.com/nirholas/xspace-agent"><img src="https://render.com/images/deploy-to-render-button.svg" alt="Deploy to Render" height="32" /></a>
</p>

Or with Docker:

```bash
docker run -e OPENAI_API_KEY=sk-... ghcr.io/nirholas/xspace-agent
```

## Documentation

Full docs live in [docs/](docs/). Key guides:

| Guide | Description |
|-------|-------------|
| [Architecture Overview](docs/architecture-overview.md) | How the system fits together |
| [Providers](docs/providers.md) | LLM, STT, and TTS provider setup |
| [Admin Panel](docs/admin-page.md) | Web dashboard guide |
| [Environment Variables](docs/env-vars-reference.md) | All config options |
| [Multi-Space Support](docs/multi-space-support.md) | Run agents across multiple Spaces |
| [Agent Memory & RAG](docs/agent-memory-rag.md) | Persistent memory and retrieval |
| [TypeScript Migration](docs/typescript-migration.md) | TypeScript usage guide |

## Project Structure

This is a **pnpm monorepo** with five publishable packages, a standalone voice agent, and supporting infrastructure.

### Packages (npm-published)

```
packages/
  core/                → xspace-agent         The main SDK. Everything needed to build an AI agent
                         ├── agent.ts            Entry point — orchestrates browser, audio, LLM, turns
                         ├── team.ts             Multi-agent coordination (multiple AIs, one Space)
                         ├── audio/              PCM capture, VAD, silence detection, WAV encoding, TTS injection
                         ├── browser/            Puppeteer lifecycle, self-healing selector engine, DOM interaction
                         ├── fsm/                Finite state machine for agent & team lifecycles
                         ├── intelligence/       Speaker ID, topic tracking, sentiment, context management
                         ├── pipeline/           Provider factories — createLLM(), createSTT(), createTTS()
                         ├── turns/              Turn coordination, decision engine, interruption handling
                         ├── plugins/            Plugin system with 6 middleware hooks (before/after stt/llm/tts)
                         ├── providers/          Multi-provider router and cost tracking
                         ├── db/                 Drizzle ORM, migrations, repositories
                         ├── auth/               X/Twitter login, token validation, OAuth, SAML
                         ├── memory/             Conversation persistence, RAG, archiving
                         ├── observability/      Structured logging (Pino), tracing, metrics
                         └── __tests__/          Unit & E2E test suites with fixtures

  server/              → @xspace/server        Express + Socket.IO admin panel
                         ├── routes/             REST API endpoints
                         ├── events/             Socket.IO real-time event handlers
                         ├── middleware/          Auth, validation, CORS, rate limiting
                         ├── schemas/            Zod request/response validation
                         ├── personalities/      Preset agent configurations
                         └── public/             Admin dashboard HTML/CSS/JS

  cli/                 → @xspace/cli           Command-line tool
                         └── commands/           init, auth, join, start, dashboard

  widget/              → @xspace/widget        Embeddable voice chat widget (UMD + ESM builds)
                         ├── connection.ts       WebSocket connection handler
                         ├── theme.ts            Theme customization
                         └── ui/                 UI components

  create-xspace-agent/ → create-xspace-agent   Project scaffolding (like create-react-app)
                         └── templates/base/     Starter project template
```

### Application Code

```
agent-voice-chat/      Standalone voice chat agent — separate from the monorepo
                       ├── server.js             Express + Socket.IO server (38KB)
                       ├── openapi.json           Full REST API spec
                       ├── agents.config.json     Agent configurations
                       ├── room-manager.js        Multi-room coordination
                       ├── knowledge/             Vector embeddings & RAG data
                       ├── memory/                Persistent conversation storage
                       ├── providers/             LLM, STT, TTS implementations
                       └── tests/                 Own test suite (vitest)

src/                   Legacy monolithic server — functional via `npm run dev`, being migrated
                       ├── server/                Express server, socket handlers, routes, metrics
                       ├── browser/               Puppeteer auth, launcher, orchestrator, selectors
                       ├── audio/                 Audio stream bridge
                       └── client/                Frontend initialization & provider configs

x-spaces/             Low-level Puppeteer automation scripts (JavaScript)
                       ├── index.js               Orchestration entry point
                       ├── audio-bridge.js         Audio capture & injection via CDP
                       ├── auth.js                 Browser cookie authentication
                       └── space-ui.js             X Spaces DOM interaction & selectors
```

### Supporting Directories

```
examples/              12 runnable projects — basic-join, multi-agent-debate, discord-bridge,
                       custom-provider, middleware-pipeline, express-integration, scheduled-spaces,
                       chrome-connect, with-plugins, and more. Each has its own package.json.

docs/                  43 markdown files — architecture overview, API reference (REST + WebSocket),
                       provider guides, deployment (Docker, Railway, Render, VPS), troubleshooting,
                       plugin system, configuration, and internal design specs.

personalities/         Pre-built agent personalities with system prompts & voice preferences
                       └── presets/               agent-zero, comedian, crypto-degen, educator,
                                                  interviewer, tech-analyst, and more

providers/             AI provider wrappers (JS) — Claude, Groq, OpenAI Chat, OpenAI Realtime, STT, TTS

public/                Frontend assets — admin dashboard, agent builder, voice chat UI,
                       widget demos (React, Vue), landing pages

docker/                Monitoring stack — Prometheus scrape configs + Grafana dashboards

tasks/                 14 implementation specs & roadmap items (landing page, design system,
                       docs site, onboarding flow, admin dashboard v2, auth, rate limiting, etc.)

tests/                 Top-level integration & load tests
```

## Examples

| Example | Description |
|---------|-------------|
| [**basic-join**](examples/basic-join/) | Join a Space with an AI agent in ~15 lines |
| [**transcription-logger**](examples/transcription-logger/) | Listen-only — save timestamped transcripts to file |
| [**multi-agent-debate**](examples/multi-agent-debate/) | Two AIs (Bull vs Bear) debate live with round-robin turns |
| [**multi-agent**](examples/multi-agent/) | Multiple AI agents sharing a single Space |
| [**custom-provider**](examples/custom-provider/) | Use a local LLM (Ollama) or any custom API backend |
| [**middleware-pipeline**](examples/middleware-pipeline/) | Content filtering, language detection, safety redaction, analytics hooks |
| [**express-integration**](examples/express-integration/) | Embed the agent in an existing Express app with admin panel |
| [**scheduled-spaces**](examples/scheduled-spaces/) | Join Spaces on a cron schedule with auto-leave timers |
| [**discord-bridge**](examples/discord-bridge/) | Control the agent from Discord — join, leave, speak, stream transcriptions |
| [**chrome-connect**](examples/chrome-connect/) | Connect to an existing Chrome instance instead of launching one |
| [**with-plugins**](examples/with-plugins/) | Extend agent behavior with custom plugins |
| [**plugins**](examples/plugins/) | Reusable plugin modules — analytics, moderation, webhooks |

```bash
cd examples/basic-join
npm install
cp .env.example .env   # fill in your API keys
npm start
```

## Architecture

```
                         X Space (live audio)
                                │
                    Puppeteer + Chrome DevTools Protocol
                                │
                    ┌───────────▼────────────┐
                    │   BrowserLifecycle      │  Auth → Join → Request Speaker → Speak
                    │   Self-healing CSS/     │  Retries selectors via CSS → text → aria
                    │   text/aria selectors   │
                    └───────────┬────────────┘
                                │  RTCPeerConnection audio hooks
                    ┌───────────▼────────────┐
                    │   AudioPipeline         │  PCM capture → VAD → silence detection
                    │                         │  → WAV encoding → TTS injection
                    └───────────┬────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          │                     │                     │
   ┌──────▼──────┐      ┌──────▼──────┐      ┌──────▼──────┐
   │  STT        │      │  LLM        │      │  TTS        │
   │  Deepgram   │      │  OpenAI     │      │  ElevenLabs │
   │  Whisper    │      │  Claude     │      │  OpenAI TTS │
   │  (Groq/OAI) │      │  Groq       │      │  Browser    │
   └──────┬──────┘      │  Custom     │      └──────┬──────┘
          │              └──────┬──────┘             │
          │    before:stt       │    before:llm      │    before:tts
          │    after:stt        │    after:llm       │    after:tts
          │  ← middleware →     │  ← middleware →     │  ← middleware →
          │                     │                     │
   ┌──────▼─────────────────────▼─────────────────────▼──────┐
   │  Intelligence Layer                                      │
   │  Speaker ID · Topic tracking · Sentiment · Context mgmt  │
   └─────────────────────────┬───────────────────────────────┘
                             │
   ┌─────────────────────────▼───────────────────────────────┐
   │  Turn Management + FSM                                   │
   │  Decision engine · Interruption handling · Response pace  │
   │                                                          │
   │  idle → launching → authenticating → joining → listening │
   │                                          ↕               │
   │                                       speaking → leaving │
   └──────────────────────────────────────────────────────────┘
```

The agent connects to X Spaces via a headless Chromium browser, hooks into the WebRTC audio stream, and routes it through a fully configurable **STT → LLM → TTS** pipeline. Every stage supports middleware for logging, filtering, translation, content moderation, and more. The intelligence layer attributes speech to speakers, tracks topics, and manages conversation context. A finite state machine governs the full agent lifecycle.

## Providers

| Category | Providers |
|----------|-----------|
| **LLM** | OpenAI (GPT-4o), Anthropic (Claude), Groq (Llama/Mixtral), any OpenAI-compatible API |
| **Speech-to-Text** | Deepgram (streaming), OpenAI Whisper, custom |
| **Text-to-Speech** | ElevenLabs, OpenAI TTS, custom |

## CLI Reference

```bash
xspace-agent init                  # Interactive setup wizard
xspace-agent auth                  # Authenticate with X
xspace-agent join <url>            # Join a Space
xspace-agent start                 # Start agent with admin panel
xspace-agent dashboard             # Launch web dashboard only
```

## Used By

<!-- Add your project here! Open a PR to be featured. -->

_Be the first! [Open a PR](CONTRIBUTING.md) to add your project._

## Community

- 🐛 [GitHub Issues](https://github.com/nirholas/xspace-agent/issues) — bug reports and feature requests
- 🗣️ [GitHub Discussions](https://github.com/nirholas/xspace-agent/discussions) — ideas and broader conversations

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions and guidelines.

**Good first contributions:**
- Add a new AI provider (Mistral, Cohere, Together)
- Add a new TTS provider (Cartesia, PlayHT)
- Build an example project
- Improve documentation

## License

All Rights Reserved &copy; 2026 nirholas


