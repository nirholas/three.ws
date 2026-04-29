# xspace-agent

TypeScript SDK for building AI voice agents in X/Twitter Spaces.

## Quick Start

```bash
npm install xspace-agent
```

```typescript
import { XSpaceAgent } from 'xspace-agent';

const agent = new XSpaceAgent({
  auth: { token: process.env.X_AUTH_TOKEN },
  ai: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    systemPrompt: 'You are a helpful AI assistant.',
  },
});

await agent.join('https://x.com/i/spaces/abc123');
```

## Features

- **Join any live X Space** — automated browser login, speaker request, and audio capture
- **Listen and respond** — real-time speech-to-text, LLM processing, text-to-speech pipeline
- **Multiple LLM providers** — OpenAI, Claude (Anthropic), Groq, or bring your own
- **Multiple TTS providers** — OpenAI TTS, ElevenLabs, or browser-native
- **Multi-agent teams** — multiple AI personalities in one Space with turn management
- **Plugin system** — extend behavior with custom hooks at every pipeline stage
- **Middleware pipeline** — intercept and transform data at each processing stage
- **Self-healing selectors** — CSS → text → aria fallback chain for resilient UI automation
- **Structured errors** — every error includes a code, message, and actionable hint
- **Config validation** — Zod-powered validation with specific error messages

## Authentication

```typescript
// Option 1: Token auth (recommended)
// Get auth_token from browser cookies: Application → Cookies → x.com → auth_token
const agent = new XSpaceAgent({
  auth: { token: 'your_auth_token' },
  // ...
});

// Option 2: Connect to your own Chrome (no login needed)
// First: google-chrome --remote-debugging-port=9222
const agent = new XSpaceAgent({
  auth: {},
  browser: { mode: 'connect', cdpPort: 9222 },
  // ...
});

// Option 3: Username/password (less reliable)
const agent = new XSpaceAgent({
  auth: { username: 'handle', password: 'secret', email: 'you@example.com' },
  // ...
});
```

## Configuration

```typescript
const agent = new XSpaceAgent({
  // Required
  auth: { token: string } | { username: string; password: string },
  ai: {
    provider: 'openai' | 'claude' | 'groq' | 'custom',
    apiKey: string,
    systemPrompt: string,
    model?: string,           // e.g. 'gpt-4o', 'claude-sonnet-4-20250514'
    maxTokens?: number,       // default: 300
    temperature?: number,
    maxHistory?: number,      // default: 20
  },

  // Optional
  voice?: {
    provider: 'openai' | 'elevenlabs' | 'browser',
    apiKey?: string,
    voiceId?: string,         // e.g. 'nova', 'onyx'
  },
  browser?: {
    mode?: 'managed' | 'connect',
    headless?: boolean,       // default: true
    cdpPort?: number,         // default: 9222 (connect mode)
  },
  behavior?: {
    autoRespond?: boolean,    // default: true
    silenceThreshold?: number,// seconds, default: 1.5
    turnDelay?: number,       // ms, default: 1500
  },
  plugins?: Plugin[],
});
```

## Events

```typescript
agent.on('transcription', ({ speaker, text, timestamp }) => { });
agent.on('response', ({ text, audio }) => { });
agent.on('status', (status) => { });          // 'launching', 'joining', 'idle', etc.
agent.on('error', (error) => { });            // XSpaceError with code + hint
agent.on('space-ended', () => { });
agent.on('speaker-joined', ({ username }) => { });
agent.on('speaker-left', ({ username }) => { });
```

## Error Handling

All errors extend `XSpaceError` with a machine-readable `code` and an actionable `hint`:

```typescript
import {
  XSpaceError,
  AuthenticationError,
  SpaceNotFoundError,
  ProviderError,
} from 'xspace-agent';

try {
  await agent.join(url);
} catch (err) {
  if (err instanceof AuthenticationError) {
    console.error(err.code);    // 'AUTH_FAILED'
    console.error(err.hint);    // 'Check your auth.token...'
  }
}
```

| Error Class | Code | When |
|---|---|---|
| `AuthenticationError` | `AUTH_FAILED` | X login fails |
| `SpaceNotFoundError` | `SPACE_NOT_FOUND` | Space URL invalid or ended |
| `SpaceEndedError` | `SPACE_ENDED` | Space ends while connected |
| `BrowserConnectionError` | `BROWSER_CONNECTION` | Chrome can't launch/connect |
| `SpeakerAccessDeniedError` | `SPEAKER_DENIED` | Host doesn't accept speaker request |
| `ProviderError` | `PROVIDER_ERROR` | LLM/STT/TTS API failure |
| `ConfigValidationError` | `CONFIG_INVALID` | Invalid configuration |
| `SelectorBrokenError` | `SELECTOR_BROKEN` | X UI changed, selectors broken |

## Config Validation

```typescript
import { validateConfig } from 'xspace-agent';

const config = validateConfig({
  auth: { token: 'abc' },
  ai: { provider: 'openai', apiKey: 'sk-...', systemPrompt: 'Hello' },
});
// Throws ConfigValidationError with specific messages if invalid
```

## Middleware

Intercept and transform data at each pipeline stage:

```typescript
// Filter profanity from transcriptions
agent.use('after:stt', (transcription) => {
  return { ...transcription, text: censor(transcription.text) };
});

// Limit response length
agent.use('after:llm', (response) => response.slice(0, 280));

// Return null to abort the pipeline
agent.use('before:tts', (text) => {
  if (text.includes('skip')) return null;
  return text;
});
```

Stages: `before:stt` → `after:stt` → `before:llm` → `after:llm` → `before:tts` → `after:tts`

## Plugin API

```typescript
import type { Plugin } from 'xspace-agent';

const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',

  async onInit(context) { },
  async onJoin(spaceUrl) { },
  async onTranscription(event) { return event; },
  async onResponse(text) { return text; },
  async onBeforeSpeak(audio) { return audio; },
  async onError(error, phase) { },
  async onLeave() { },
  async onDestroy() { },
};

const agent = new XSpaceAgent({ plugins: [myPlugin], /* ... */ });
```

## Multi-Agent Teams

```typescript
import { AgentTeam } from 'xspace-agent';

const team = new AgentTeam({
  auth: { token: process.env.X_AUTH_TOKEN },
  agents: [
    {
      name: 'Host',
      ai: { provider: 'openai', apiKey: '...', systemPrompt: '...' },
      voice: { provider: 'openai', voiceId: 'nova' },
      topics: ['introductions', 'moderation'],
    },
    {
      name: 'Expert',
      ai: { provider: 'claude', apiKey: '...', systemPrompt: '...' },
      voice: { provider: 'openai', voiceId: 'onyx' },
      topics: ['technology', 'science'],
    },
  ],
  turnManagement: {
    strategy: 'director',  // AI picks the best agent per turn
    turnDelay: 2000,
  },
});

await team.join('https://x.com/i/spaces/abc123');
```

Turn strategies: `'queue'` (FIFO), `'round-robin'`, `'director'` (AI-driven)

## Examples

See the [`examples/`](../../examples/) directory:

- **basic-join** — Simplest possible agent
- **chrome-connect** — Use your own logged-in Chrome
- **multi-agent-debate** — Two agents debating with round-robin turns
- **with-plugins** — Custom plugins for logging and response filtering
- **custom-provider** — Bring your own LLM
- **middleware-pipeline** — Data transformation at each stage
- **express-integration** — HTTP server with agent control API

## License

MIT


