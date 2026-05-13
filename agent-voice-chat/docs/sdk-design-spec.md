> **Historical Document**: This was the original design specification for the SDK refactor.
> The core SDK was implemented largely as described here. For the current architecture —
> which now includes an enterprise platform layer with multi-tenancy, auth, billing, and
> 15+ additional modules — see [architecture-overview.md](./architecture-overview.md).
> For SDK implementation details, see [CLAUDE.md](../CLAUDE.md).

# Prompt: Transform into an SDK / Framework

## The Big Picture
This project needs to go from "an app you clone and run" to "a library you install and build with." That's the difference between 50 GitHub stars and 5,000.

**Current**: Clone repo → configure .env → run server → use admin panel
**Target**: `npm install xspace-agent` → import in your code → build whatever you want

## Monorepo Structure

Use a monorepo (pnpm workspaces or Turborepo) with separate packages:

```
xspace-agent/
├── packages/
│   ├── core/                    ← The SDK — zero dependencies on Express/Socket.IO
│   │   ├── src/
│   │   │   ├── index.ts         ← Main exports
│   │   │   ├── agent.ts         ← XSpaceAgent class (the main entry point)
│   │   │   ├── browser/
│   │   │   │   ├── launcher.ts  ← Puppeteer launch with stealth
│   │   │   │   ├── auth.ts      ← X login strategies
│   │   │   │   ├── space-ui.ts  ← DOM interactions
│   │   │   │   └── selectors.ts ← CSS selectors
│   │   │   ├── audio/
│   │   │   │   ├── bridge.ts    ← Bidirectional audio bridge
│   │   │   │   ├── vad.ts       ← Voice activity detection
│   │   │   │   └── pcm.ts      ← PCM utilities
│   │   │   ├── pipeline/
│   │   │   │   ├── stt.ts       ← STT interface + implementations
│   │   │   │   ├── llm.ts       ← LLM interface + implementations
│   │   │   │   ├── tts.ts       ← TTS interface + implementations
│   │   │   │   └── types.ts     ← Pipeline types
│   │   │   ├── providers/
│   │   │   │   ├── index.ts     ← Provider registry
│   │   │   │   ├── openai.ts
│   │   │   │   ├── claude.ts
│   │   │   │   ├── groq.ts
│   │   │   │   └── custom.ts    ← Interface for user-defined providers
│   │   │   └── types.ts         ← All public types
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── cli/                     ← CLI tool
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── commands/
│   │   │       ├── start.ts     ← Start agent with config
│   │   │       ├── join.ts      ← Join a specific Space
│   │   │       ├── auth.ts      ← Login to X interactively
│   │   │       └── init.ts      ← Generate config file
│   │   └── package.json
│   │
│   ├── server/                  ← The admin panel + WebSocket API (current app)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── routes.ts
│   │   │   ├── socket-handlers.ts
│   │   │   └── middleware/
│   │   ├── public/              ← Admin panel, dashboard
│   │   └── package.json
│   │
│   └── react/                   ← React components (optional, phase 2)
│       ├── src/
│       │   ├── AgentPanel.tsx
│       │   ├── AudioVisualizer.tsx
│       │   └── TranscriptView.tsx
│       └── package.json
│
├── examples/                    ← Example projects
│   ├── basic-join/
│   ├── multi-agent/
│   ├── custom-provider/
│   ├── discord-bot-bridge/
│   └── express-integration/
│
├── docs/                        ← Documentation site source
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

## The Core SDK API

This is the most important part. The API should be so clean that anyone can understand it in 30 seconds:

### Minimal Example (README hero code)
```typescript
import { XSpaceAgent } from 'xspace-agent'

const agent = new XSpaceAgent({
  auth: { token: process.env.X_AUTH_TOKEN },
  ai: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    systemPrompt: 'You are a helpful AI that discusses technology.'
  },
  voice: {
    provider: 'elevenlabs',
    voiceId: 'your-voice-id'
  }
})

// Join a Space and start participating
await agent.join('https://x.com/i/spaces/1abc...')

// Listen to events
agent.on('transcription', ({ speaker, text }) => {
  console.log(`${speaker}: ${text}`)
})

agent.on('response', ({ text, audio }) => {
  console.log(`Agent said: ${text}`)
})

// Graceful shutdown
process.on('SIGINT', () => agent.leave())
```

That's it. **12 lines to have an AI agent in an X Space.** This is what makes people share a project.

### Full API Surface

```typescript
// === XSpaceAgent Class ===

class XSpaceAgent extends EventEmitter {
  constructor(config: AgentConfig)

  // Lifecycle
  join(spaceUrl: string): Promise<void>
  leave(): Promise<void>
  destroy(): Promise<void>          // Full cleanup

  // Status
  getStatus(): AgentStatus           // 'disconnected' | 'launching' | 'logged-in' | 'joining' | 'speaking'
  isConnected(): boolean

  // Speaking
  say(text: string): Promise<void>   // Generate TTS and speak
  sayAudio(buffer: Buffer): Promise<void>  // Inject raw audio
  mute(): Promise<void>
  unmute(): Promise<void>

  // AI Pipeline
  setSystemPrompt(prompt: string): void
  setProvider(provider: ProviderConfig): void
  getConversationHistory(): Message[]
  clearHistory(): void

  // Events (EventEmitter)
  on(event: 'transcription', cb: (data: { speaker: string, text: string }) => void): this
  on(event: 'response', cb: (data: { text: string, audio: Buffer }) => void): this
  on(event: 'status', cb: (status: AgentStatus) => void): this
  on(event: 'error', cb: (error: Error) => void): this
  on(event: 'speaker-joined', cb: (data: { username: string }) => void): this
  on(event: 'speaker-left', cb: (data: { username: string }) => void): this
  on(event: 'space-ended', cb: () => void): this
  on(event: 'audio-chunk', cb: (chunk: Float32Array) => void): this
}

// === Configuration Types ===

interface AgentConfig {
  auth: AuthConfig
  ai: AIConfig
  voice?: VoiceConfig
  browser?: BrowserConfig
  behavior?: BehaviorConfig
}

interface AuthConfig {
  token?: string              // X auth_token cookie
  ct0?: string                // CSRF token
  username?: string           // For form login
  password?: string
  email?: string              // For verification
  cookiePath?: string         // Path to cookie file
}

interface AIConfig {
  provider: 'openai' | 'claude' | 'groq' | 'custom'
  model?: string
  apiKey?: string
  systemPrompt: string
  maxTokens?: number
  temperature?: number
  maxHistory?: number         // Max conversation messages to keep
  custom?: CustomProvider     // For custom provider
}

interface VoiceConfig {
  provider: 'elevenlabs' | 'openai' | 'browser'
  apiKey?: string
  voiceId?: string
  speed?: number
  stability?: number
}

interface BrowserConfig {
  headless?: boolean          // Default: true
  executablePath?: string     // Custom Chrome path
  userDataDir?: string        // Browser profile directory
  proxy?: string              // Proxy URL
  args?: string[]             // Extra Chromium args
}

interface BehaviorConfig {
  autoRespond?: boolean       // Auto-respond to speakers (default: true)
  silenceThreshold?: number   // Seconds of silence before stopping recording
  minSpeechDuration?: number  // Minimum speech duration to process
  maxResponseLength?: number  // Max response tokens
  respondToSelf?: boolean     // Respond to own audio (default: false)
  turnDelay?: number          // Delay between turns (ms)
}
```

### Custom Provider Interface
This is critical for adoption — let people bring their own AI:

```typescript
interface CustomProvider {
  type: 'socket'  // server-side processing

  generateResponse(params: {
    messages: Message[],
    systemPrompt: string
  }): Promise<string>   // Return text response

  // Optional: streaming
  generateResponseStream?(params: {
    messages: Message[],
    systemPrompt: string
  }): AsyncIterable<string>
}

// Usage:
const agent = new XSpaceAgent({
  auth: { token: '...' },
  ai: {
    provider: 'custom',
    systemPrompt: '...',
    custom: {
      type: 'socket',
      async generateResponse({ messages, systemPrompt }) {
        // Call your own AI, local model, RAG pipeline, whatever
        const response = await myCustomAI.chat(messages)
        return response.text
      }
    }
  }
})
```

### Multi-Agent Support
```typescript
import { XSpaceAgent, AgentTeam } from 'xspace-agent'

const team = new AgentTeam({
  auth: { token: process.env.X_AUTH_TOKEN },
  agents: [
    {
      name: 'Bob',
      ai: { provider: 'claude', systemPrompt: 'You are Bob, a crypto expert...' },
      voice: { provider: 'elevenlabs', voiceId: 'voice-1' }
    },
    {
      name: 'Alice',
      ai: { provider: 'openai', systemPrompt: 'You are Alice, a tech analyst...' },
      voice: { provider: 'elevenlabs', voiceId: 'voice-2' }
    }
  ],
  turnManagement: {
    strategy: 'queue',      // 'queue' | 'round-robin' | 'director'
    turnDelay: 500
  }
})

await team.join('https://x.com/i/spaces/...')

team.on('transcription', ({ speaker, text, respondingAgent }) => {
  console.log(`${speaker}: ${text} → ${respondingAgent.name} is responding`)
})
```

### Middleware / Hooks
Let users intercept and modify the pipeline:

```typescript
const agent = new XSpaceAgent({ ... })

// Before STT — modify audio
agent.use('before:stt', (audioChunk) => {
  return applyNoiseReduction(audioChunk)
})

// After STT — modify/filter transcription
agent.use('after:stt', (transcription) => {
  if (transcription.text.length < 5) return null  // ignore short utterances
  return transcription
})

// Before LLM — modify prompt or messages
agent.use('before:llm', (messages, systemPrompt) => {
  // Inject real-time data into context
  const price = await getEthPrice()
  messages.push({ role: 'system', content: `Current ETH price: $${price}` })
  return { messages, systemPrompt }
})

// After LLM — modify/filter response
agent.use('after:llm', (response) => {
  return response.replace(/bad-word/gi, '***')
})

// Before TTS — modify text or skip speaking
agent.use('before:tts', (text) => {
  if (text.length > 500) return text.substring(0, 500) + '...'
  return text
})
```

## Package Names
- `xspace-agent` — the core SDK (what most people install)
- `@xspace/cli` — CLI tool
- `@xspace/server` — admin panel + API server
- `@xspace/react` — React components (phase 2)

Or use a single package with subpath exports:
```json
{
  "exports": {
    ".": "./dist/index.js",
    "./server": "./dist/server/index.js",
    "./cli": "./dist/cli/index.js"
  }
}
```

## Why This Architecture Goes Viral

1. **Low barrier**: `npm install` + 12 lines = working agent
2. **Composable**: Middleware lets people build anything on top
3. **Custom providers**: Not locked to OpenAI — bring your own model
4. **Multi-agent**: The `AgentTeam` API is unique, nobody else has this
5. **TypeScript**: Full autocomplete, developers trust typed libraries
6. **Extensible**: Hooks at every pipeline stage
7. **Framework-agnostic**: Works in Express, Fastify, Next.js, standalone scripts

## Implementation Steps
1. Set up monorepo with pnpm workspaces + Turborepo
2. Move existing code into `packages/core/src/` with TypeScript
3. Design and implement the `XSpaceAgent` class as the public API
4. Wrap existing x-spaces/ module behind the clean interface
5. Implement EventEmitter events for all lifecycle stages
6. Add middleware/hooks system
7. Implement `AgentTeam` for multi-agent
8. Create `packages/cli/` wrapping the core
9. Move server.js into `packages/server/` using core as dependency
10. Write examples in `examples/`
11. Publish to npm

## Validation
- [ ] `npm install xspace-agent` works
- [ ] 12-line example from README actually works
- [ ] Custom provider interface works with a simple echo provider
- [ ] Middleware hooks fire in correct order
- [ ] AgentTeam manages turn-taking between agents
- [ ] TypeScript types provide full autocomplete
- [ ] Zero breaking changes to existing server functionality


