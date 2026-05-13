# Factory Functions

Factory functions for creating provider instances. These are used internally by `XSpaceAgent` and `AgentTeam`, but are exported for advanced usage where you need direct access to a provider.

```ts
import { createLLM, createSTT, createTTS } from 'xspace-agent'
```

---

## createLLM

Create an LLM provider instance.

```ts
function createLLM(config: AIConfig): LLMProvider
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | [`AIConfig`](./configuration.md#aiconfig) | LLM configuration |

**Returns:** [`LLMProvider`](./configuration.md#llmprovider)

### Supported Providers

| Provider | Model Default | API Key Env |
|----------|---------------|-------------|
| `'claude'` | `claude-sonnet-4-20250514` | `ANTHROPIC_API_KEY` |
| `'openai'` | `gpt-4o` | `OPENAI_API_KEY` |
| `'groq'` | `llama-3.3-70b-versatile` | `GROQ_API_KEY` |
| `'custom'` | N/A | N/A |

**Example:**

```ts
const llm = createLLM({
  provider: 'claude',
  apiKey: process.env.ANTHROPIC_API_KEY,
  systemPrompt: 'You are a helpful assistant.',
  maxTokens: 500,
  temperature: 0.7,
})

// Stream a response
let response = ''
for await (const token of llm.streamResponse(0, 'Hello!', 'You are helpful.')) {
  response += token
}
console.log(response)

// Check health
const health = await llm.checkHealth?.()
console.log(health) // { ok: true, latencyMs: 142 }

// Get metrics
const metrics = llm.getMetrics?.()
console.log(metrics) // { requestCount: 1, successCount: 1, ... }
```

---

## createSTT

Create a speech-to-text provider instance.

```ts
function createSTT(config: STTConfig): STTProvider
```

### STTConfig

```ts
interface STTConfig {
  provider: 'groq' | 'openai'
  apiKey: string
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | `'groq' \| 'openai'` | Yes | STT provider |
| `apiKey` | `string` | Yes | API key |

**Returns:** [`STTProvider`](./configuration.md#sttprovider)

### Provider Details

| Provider | Model | Notes |
|----------|-------|-------|
| `'openai'` | `whisper-1` | OpenAI Whisper |
| `'groq'` | `whisper-large-v3` | Groq-hosted Whisper (faster, free tier available) |

**Example:**

```ts
const stt = createSTT({
  provider: 'groq',
  apiKey: process.env.GROQ_API_KEY,
})

const wavBuffer = fs.readFileSync('recording.wav')
const { text } = await stt.transcribe(wavBuffer, 'audio/wav')
console.log(text) // "Hello, how are you?"
```

---

## createTTS

Create a text-to-speech provider instance.

```ts
function createTTS(config: TTSConfig): TTSProvider
```

### TTSConfig

```ts
interface TTSConfig {
  provider: 'elevenlabs' | 'openai' | 'browser'
  apiKey?: string
  voiceId?: string
  speed?: number
  stability?: number
  voiceMap?: Record<number, string>
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `provider` | `'elevenlabs' \| 'openai' \| 'browser'` | Yes | — | TTS provider |
| `apiKey` | `string` | No | — | API key (required for `elevenlabs` and `openai`) |
| `voiceId` | `string` | No | Per-provider | Default voice identifier |
| `speed` | `number` | No | — | Speech speed multiplier |
| `stability` | `number` | No | `0.5` | Voice stability (ElevenLabs only) |
| `voiceMap` | `Record<number, string>` | No | — | Per-agent voice overrides (agent ID → voice ID) |

**Returns:** [`TTSProvider`](./configuration.md#ttsprovider)

### Provider Details

| Provider | Model | Default Voice | Notes |
|----------|-------|---------------|-------|
| `'openai'` | `tts-1` | `alloy` | OpenAI TTS |
| `'elevenlabs'` | `eleven_multilingual_v2` | `VR6AewLTigWG4xSOukaG` | ElevenLabs — multilingual, high quality |
| `'browser'` | N/A | N/A | Returns `null`; for client-side TTS |

### Voice Map

Use `voiceMap` to assign different voices to different agents in a team:

```ts
const tts = createTTS({
  provider: 'elevenlabs',
  apiKey: process.env.ELEVENLABS_API_KEY,
  voiceMap: {
    0: 'VR6AewLTigWG4xSOukaG',  // Agent 0 voice
    1: 'TxGEqnHWrfWFTfGW9XjX',  // Agent 1 voice
  },
})

const audio0 = await tts.synthesize('Hello from agent zero', 0)
const audio1 = await tts.synthesize('Hello from agent one', 1)
```

**Example:**

```ts
const tts = createTTS({
  provider: 'openai',
  apiKey: process.env.OPENAI_API_KEY,
  voiceId: 'nova',
  speed: 1.1,
})

const audioBuffer = await tts.synthesize('Welcome to the Space!')
// audioBuffer is a Buffer containing audio data
```


