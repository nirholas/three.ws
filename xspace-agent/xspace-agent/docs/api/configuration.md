# Configuration Types

All configuration interfaces and shared types for the `xspace-agent` SDK.

```ts
import type {
  AgentConfig,
  AuthConfig,
  AIConfig,
  VoiceConfig,
  BrowserConfig,
  BehaviorConfig,
  AgentStatus,
  Message,
  MiddlewareStage,
  TranscriptionEvent,
  ResponseEvent,
  SpeakerEvent,
  AgentTeamConfig,
  TeamAgentConfig,
  TurnManagementConfig,
  CustomProvider,
  LLMProvider,
  STTProvider,
  TTSProvider,
} from 'xspace-agent'
```

---

## AgentConfig

Top-level configuration for [`XSpaceAgent`](./xspace-agent.md).

```ts
interface AgentConfig {
  auth: AuthConfig
  ai: AIConfig
  voice?: VoiceConfig
  browser?: BrowserConfig
  behavior?: BehaviorConfig
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `auth` | [`AuthConfig`](#authconfig) | Yes | X authentication credentials |
| `ai` | [`AIConfig`](#aiconfig) | Yes | LLM provider and prompt settings |
| `voice` | [`VoiceConfig`](#voiceconfig) | No | TTS provider and voice selection |
| `browser` | [`BrowserConfig`](#browserconfig) | No | Headless browser options |
| `behavior` | [`BehaviorConfig`](#behaviorconfig) | No | Auto-respond, silence threshold, etc. |

---

## AuthConfig

Authentication credentials for X. Provide **either** cookie-based auth (`token` + `ct0`) **or** form-based auth (`username` + `password`).

```ts
interface AuthConfig {
  token?: string
  ct0?: string
  username?: string
  password?: string
  email?: string
  cookiePath?: string
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `token` | `string` | No | X `auth_token` cookie value |
| `ct0` | `string` | No | X CSRF token cookie value |
| `username` | `string` | No | X username for form login |
| `password` | `string` | No | X password for form login |
| `email` | `string` | No | Email address for verification prompts during login |
| `cookiePath` | `string` | No | Path to a cookie file on disk |

### Authentication Methods

**Cookie auth (recommended):** Provide `token` and `ct0`. Fastest and most reliable — skips the login flow.

```ts
auth: {
  token: 'your_auth_token_cookie',
  ct0: 'your_ct0_cookie',
}
```

**Form auth:** Provide `username` and `password`. Optionally include `email` for verification challenges. Note: 2FA is not supported with form auth.

```ts
auth: {
  username: 'your_username',
  password: 'your_password',
  email: 'your@email.com',  // optional, for verification
}
```

**Cookie file:** Provide a path to a Netscape-format cookie file.

```ts
auth: {
  cookiePath: './cookies.txt',
}
```

---

## AIConfig

LLM provider configuration.

```ts
interface AIConfig {
  provider: 'openai' | 'claude' | 'groq' | 'custom'
  model?: string
  apiKey?: string
  systemPrompt: string
  maxTokens?: number
  temperature?: number
  maxHistory?: number
  timeout?: {
    streamStart?: number
    total?: number
  }
  cache?: {
    enabled?: boolean
    maxSize?: number
    ttlMs?: number
  }
  custom?: CustomProvider
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `provider` | `'openai' \| 'claude' \| 'groq' \| 'custom'` | Yes | — | LLM provider to use |
| `model` | `string` | No | Per-provider (see below) | Model identifier |
| `apiKey` | `string` | No | — | API key for the provider |
| `systemPrompt` | `string` | Yes | — | System prompt sent with every request |
| `maxTokens` | `number` | No | `300` | Maximum tokens in a single response |
| `temperature` | `number` | No | — | Sampling temperature |
| `maxHistory` | `number` | No | `20` | Max conversation messages retained |
| `timeout.streamStart` | `number` | No | `30000` | Milliseconds to wait for the stream to start |
| `timeout.total` | `number` | No | `120000` | Total milliseconds allowed for the request |
| `cache.enabled` | `boolean` | No | `false` | Enable response caching for repeated queries |
| `cache.maxSize` | `number` | No | `100` | Maximum cached entries |
| `cache.ttlMs` | `number` | No | `300000` | Cache entry TTL (5 minutes) |
| `custom` | [`CustomProvider`](#customprovider) | No | — | Required when `provider` is `'custom'` |

### Default Models

| Provider | Default Model |
|----------|---------------|
| `claude` | `claude-sonnet-4-20250514` |
| `openai` | `gpt-4o` |
| `groq` | `llama-3.3-70b-versatile` |

---

## VoiceConfig

Text-to-speech provider configuration.

```ts
interface VoiceConfig {
  provider: 'elevenlabs' | 'openai' | 'browser'
  apiKey?: string
  voiceId?: string
  speed?: number
  stability?: number
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `provider` | `'elevenlabs' \| 'openai' \| 'browser'` | Yes | — | TTS provider |
| `apiKey` | `string` | No | Falls back to `ai.apiKey` | API key for the TTS provider |
| `voiceId` | `string` | No | Per-provider (see below) | Voice identifier |
| `speed` | `number` | No | — | Speech speed multiplier |
| `stability` | `number` | No | `0.5` (ElevenLabs) | Voice stability (ElevenLabs only) |

### Default Voices

| Provider | Agent 0 | Agent 1 |
|----------|---------|---------|
| `openai` | `onyx` | `nova` |
| `elevenlabs` | `VR6AewLTigWG4xSOukaG` | `TxGEqnHWrfWFTfGW9XjX` |
| `browser` | N/A (client-side TTS) | N/A |

---

## BrowserConfig

Puppeteer browser configuration.

```ts
interface BrowserConfig {
  headless?: boolean
  executablePath?: string
  userDataDir?: string
  proxy?: string
  args?: string[]
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `headless` | `boolean` | No | `true` | Run the browser in headless mode |
| `executablePath` | `string` | No | — | Custom path to Chrome/Chromium |
| `userDataDir` | `string` | No | — | Browser profile directory |
| `proxy` | `string` | No | — | Proxy URL (e.g., `http://proxy:8080`) |
| `args` | `string[]` | No | — | Extra Chromium CLI arguments |

---

## BehaviorConfig

Controls how the agent responds to audio.

```ts
interface BehaviorConfig {
  autoRespond?: boolean
  silenceThreshold?: number
  minSpeechDuration?: number
  maxResponseLength?: number
  respondToSelf?: boolean
  turnDelay?: number
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `autoRespond` | `boolean` | No | `true` | Automatically respond when speech is detected |
| `silenceThreshold` | `number` | No | `1.5` | Seconds of silence before the recorder stops capturing |
| `minSpeechDuration` | `number` | No | — | Minimum speech duration (seconds) to process audio |
| `maxResponseLength` | `number` | No | — | Max tokens in a single response |
| `respondToSelf` | `boolean` | No | `false` | Whether the agent responds to its own audio |
| `turnDelay` | `number` | No | — | Delay in milliseconds between conversation turns |

---

## AgentTeamConfig

Configuration for [`AgentTeam`](./agent-team.md).

```ts
interface AgentTeamConfig {
  auth: AuthConfig
  agents: TeamAgentConfig[]
  browser?: BrowserConfig
  turnManagement?: TurnManagementConfig
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `auth` | [`AuthConfig`](#authconfig) | Yes | Shared X authentication credentials |
| `agents` | [`TeamAgentConfig[]`](#teamagentconfig) | Yes | Array of agent configurations (at least 1) |
| `browser` | [`BrowserConfig`](#browserconfig) | No | Shared browser options |
| `turnManagement` | [`TurnManagementConfig`](#turnmanagementconfig) | No | Turn-taking strategy |

---

## TeamAgentConfig

Configuration for an individual agent within a team.

```ts
interface TeamAgentConfig {
  name: string
  ai: AIConfig
  voice?: VoiceConfig
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Display name for the agent |
| `ai` | [`AIConfig`](#aiconfig) | Yes | LLM configuration for this agent |
| `voice` | [`VoiceConfig`](#voiceconfig) | No | TTS configuration for this agent |

---

## TurnManagementConfig

Controls how agents take turns in an [`AgentTeam`](./agent-team.md).

```ts
interface TurnManagementConfig {
  strategy: 'queue' | 'round-robin' | 'director'
  turnDelay?: number
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `strategy` | `'queue' \| 'round-robin' \| 'director'` | Yes | — | Turn-taking strategy |
| `turnDelay` | `number` | No | `500` | Milliseconds between turns |

---

## AgentStatus

Union type representing all possible agent lifecycle states.

```ts
type AgentStatus =
  | 'disconnected'
  | 'launching'
  | 'logging-in'
  | 'logged-in'
  | 'joining'
  | 'in-space'
  | 'speaking'
  | 'listening'
  | 'idle'
  | 'space-ended'
  | 'error'
```

| Value | Description |
|-------|-------------|
| `disconnected` | Agent is not running. Initial state and state after `destroy()`. |
| `launching` | Browser is being launched. |
| `logging-in` | Authenticating with X. |
| `logged-in` | Successfully authenticated. Also the state after `leave()`. |
| `joining` | Navigating to the Space and requesting speaker access. |
| `in-space` | Connected to the Space (internal, transitions quickly to `idle`). |
| `speaking` | Agent is generating or playing a response. |
| `listening` | Speech detected, transcription in progress. |
| `idle` | Connected and waiting for speech. |
| `space-ended` | The X Space has ended. |
| `error` | An unrecoverable error occurred. |

---

## Message

A single message in the conversation history.

```ts
interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}
```

| Field | Type | Description |
|-------|------|-------------|
| `role` | `'user' \| 'assistant' \| 'system'` | Who sent the message |
| `content` | `string` | The message text |

---

## TranscriptionEvent

Emitted when speech is transcribed.

```ts
interface TranscriptionEvent {
  speaker: string
  text: string
  timestamp: number
}
```

| Field | Type | Description |
|-------|------|-------------|
| `speaker` | `string` | Speaker identifier (e.g., `'Space Speaker'`) |
| `text` | `string` | Transcribed text |
| `timestamp` | `number` | Unix timestamp in milliseconds |

---

## ResponseEvent

Emitted when the agent generates a response.

```ts
interface ResponseEvent {
  text: string
  audio?: Buffer
}
```

| Field | Type | Description |
|-------|------|-------------|
| `text` | `string` | The response text |
| `audio` | `Buffer \| undefined` | Synthesized audio buffer (absent if TTS returned null) |

---

## SpeakerEvent

Emitted when a speaker joins or leaves the Space.

```ts
interface SpeakerEvent {
  username: string
}
```

| Field | Type | Description |
|-------|------|-------------|
| `username` | `string` | X username of the speaker |

---

## MiddlewareStage

The six pipeline stages where middleware can be registered via [`agent.use()`](./xspace-agent.md#usestage-handler).

```ts
type MiddlewareStage =
  | 'before:stt'
  | 'after:stt'
  | 'before:llm'
  | 'after:llm'
  | 'before:tts'
  | 'after:tts'
```

| Stage | When it runs | Input | Expected return |
|-------|-------------|-------|-----------------|
| `before:stt` | Before speech-to-text | `Buffer` (WAV audio) | `Buffer \| null` |
| `after:stt` | After speech-to-text | `TranscriptionEvent` | `TranscriptionEvent \| null` |
| `before:llm` | Before LLM call | `{ messages: Message[], systemPrompt: string }` | `{ messages, systemPrompt } \| null` |
| `after:llm` | After LLM response | `string` (response text) | `string \| null` |
| `before:tts` | Before text-to-speech | `string` (text to speak) | `string \| null` |
| `after:tts` | After text-to-speech | `Buffer` (audio) | `Buffer \| null` |

Returning `null` from any middleware cancels the pipeline at that stage.

---

## LLMProvider

Interface for LLM provider implementations. Returned by [`createLLM()`](./factories.md#createllm).

```ts
interface LLMProvider {
  type: 'socket' | 'webrtc'
  streamResponse(agentId: number, userText: string, systemPrompt: string): AsyncIterable<string>
  clearHistory?(agentId: number): void
  checkHealth?(): Promise<{ ok: boolean; latencyMs: number; error?: string }>
  getMetrics?(): ProviderMetrics
}
```

| Method | Description |
|--------|-------------|
| `streamResponse` | Stream LLM response tokens for a given user message |
| `clearHistory` | Clear conversation history for a specific agent (optional) |
| `checkHealth` | Check provider connectivity and latency (optional) |
| `getMetrics` | Get usage and performance metrics (optional) |

---

## STTProvider

Interface for speech-to-text providers. Returned by [`createSTT()`](./factories.md#createstt).

```ts
interface STTProvider {
  transcribe(audioBuffer: Buffer, mimeType?: string): Promise<{ text: string }>
}
```

| Method | Description |
|--------|-------------|
| `transcribe` | Transcribe audio to text. Returns `{ text }`. |

---

## TTSProvider

Interface for text-to-speech providers. Returned by [`createTTS()`](./factories.md#createtts).

```ts
interface TTSProvider {
  synthesize(text: string, agentId?: number): Promise<Buffer | null>
}
```

| Method | Description |
|--------|-------------|
| `synthesize` | Convert text to audio. Returns a `Buffer` or `null` (browser provider). `agentId` selects the voice for multi-agent setups. |

---

## CustomProvider

Interface for plugging in a custom LLM.

```ts
interface CustomProvider {
  type: 'socket'
  generateResponse(params: { messages: Message[]; systemPrompt: string }): Promise<string>
  generateResponseStream?(params: { messages: Message[]; systemPrompt: string }): AsyncIterable<string>
}
```

| Method | Required | Description |
|--------|----------|-------------|
| `generateResponse` | Yes | Generate a complete response |
| `generateResponseStream` | No | Stream response tokens (preferred when available) |

**Example:**

```ts
const agent = new XSpaceAgent({
  auth: { token: '...' , ct0: '...' },
  ai: {
    provider: 'custom',
    systemPrompt: 'You are a helpful assistant.',
    custom: {
      type: 'socket',
      async generateResponse({ messages, systemPrompt }) {
        const res = await myLLM.chat(systemPrompt, messages)
        return res.text
      },
      async *generateResponseStream({ messages, systemPrompt }) {
        for await (const chunk of myLLM.stream(systemPrompt, messages)) {
          yield chunk.text
        }
      },
    },
  },
})
```

---

## ProviderMetrics

Usage and performance metrics for an LLM provider.

```ts
interface ProviderMetrics {
  requestCount: number
  successCount: number
  errorCount: number
  totalInputTokens: number
  totalOutputTokens: number
  avgLatencyMs: number
  avgTimeToFirstTokenMs: number
}
```

| Field | Type | Description |
|-------|------|-------------|
| `requestCount` | `number` | Total requests made |
| `successCount` | `number` | Successful requests |
| `errorCount` | `number` | Failed requests |
| `totalInputTokens` | `number` | Total input tokens consumed |
| `totalOutputTokens` | `number` | Total output tokens generated |
| `avgLatencyMs` | `number` | Average request latency |
| `avgTimeToFirstTokenMs` | `number` | Average time to first streamed token |


