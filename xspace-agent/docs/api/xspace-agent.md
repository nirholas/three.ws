# XSpaceAgent

Create and manage an AI voice agent in X Spaces. Handles the full lifecycle: browser launch, authentication, joining a Space, speech-to-text, LLM response generation, text-to-speech, and audio injection.

Extends `EventEmitter`.

```ts
import { XSpaceAgent } from 'xspace-agent'
```

## Constructor

```ts
new XSpaceAgent(config: AgentConfig)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `config` | [`AgentConfig`](./configuration.md#agentconfig) | Yes | Full agent configuration |

The constructor initializes the LLM, STT, TTS, and VAD subsystems based on the provided config. No browser is launched until `join()` is called.

**Example:**

```ts
const agent = new XSpaceAgent({
  auth: { token: 'your_auth_token', ct0: 'your_ct0_token' },
  ai: {
    provider: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    systemPrompt: 'You are a podcast co-host who specializes in tech news.',
    maxHistory: 30,
  },
  voice: {
    provider: 'elevenlabs',
    apiKey: process.env.ELEVENLABS_API_KEY,
    voiceId: 'VR6AewLTigWG4xSOukaG',
  },
  browser: { headless: true },
  behavior: { silenceThreshold: 2.0, autoRespond: true },
})
```

## Methods

### join(spaceUrl)

```ts
async join(spaceUrl: string): Promise<void>
```

Launch a browser, log in to X, navigate to the Space, and request speaker access. The agent begins listening for audio once it becomes a speaker.

| Parameter | Type | Description |
|-----------|------|-------------|
| `spaceUrl` | `string` | Full URL of the X Space (e.g., `https://x.com/i/spaces/1eaKbrPAqbwKX`) |

**Throws:**
- `Error` if the agent is already running (call `leave()` or `destroy()` first)
- `Error` if authentication fails
- `Error` if the Space cannot be joined

**Status transitions:** `disconnected` → `launching` → `logging-in` → `logged-in` → `joining` → `idle`

---

### leave()

```ts
async leave(): Promise<void>
```

Leave the current Space while keeping the browser session alive. You can call `join()` again to enter a different Space.

**Status transitions:** current status → `logged-in`

---

### destroy()

```ts
async destroy(): Promise<void>
```

Close the browser, release all resources, and remove all event listeners. The agent cannot be reused after calling `destroy()`.

**Status transitions:** current status → `disconnected`

---

### say(text)

```ts
async say(text: string): Promise<void>
```

Synthesize text to speech and inject the audio into the Space. Runs `before:tts` and `after:tts` middleware. Emits a `response` event on completion.

| Parameter | Type | Description |
|-----------|------|-------------|
| `text` | `string` | Text to speak |

---

### sayAudio(buffer)

```ts
async sayAudio(buffer: Buffer): Promise<void>
```

Inject a pre-synthesized audio buffer directly into the Space. Audio capture is paused during playback and resumes ~1.5s after completion to avoid echo.

| Parameter | Type | Description |
|-----------|------|-------------|
| `buffer` | `Buffer` | Audio data to inject |

**Throws:** `Error` if not connected to a Space.

---

### mute()

```ts
async mute(): Promise<void>
```

Pause audio capture. The agent stops listening to the Space but remains connected.

---

### unmute()

```ts
async unmute(): Promise<void>
```

Resume audio capture after a `mute()`.

---

### setSystemPrompt(prompt)

```ts
setSystemPrompt(prompt: string): void
```

Update the LLM system prompt at runtime. Takes effect on the next response.

| Parameter | Type | Description |
|-----------|------|-------------|
| `prompt` | `string` | New system prompt |

---

### getConversationHistory()

```ts
getConversationHistory(): Message[]
```

Returns a shallow copy of the conversation history. Each entry is a [`Message`](./configuration.md#message) with `role` and `content`.

---

### clearHistory()

```ts
clearHistory(): void
```

Clear the conversation history and the LLM provider's internal history.

---

### getStatus()

```ts
getStatus(): AgentStatus
```

Returns the current [`AgentStatus`](./configuration.md#agentstatus).

---

### isConnected()

```ts
isConnected(): boolean
```

Returns `true` if the agent status is anything other than `'disconnected'` or `'error'`.

---

### use(stage, handler)

```ts
use(stage: MiddlewareStage, handler: (...args: any[]) => any): this
```

Register a middleware handler for a pipeline stage. Returns `this` for chaining.

| Parameter | Type | Description |
|-----------|------|-------------|
| `stage` | [`MiddlewareStage`](./configuration.md#middlewarestage) | Pipeline hook point |
| `handler` | `Function` | Middleware function (see below) |

Returning `null` from a middleware handler cancels the pipeline at that stage.

**Middleware signatures by stage:**

| Stage | Input | Expected Return |
|-------|-------|-----------------|
| `before:stt` | `(audioBuffer: Buffer)` | `Buffer \| null` |
| `after:stt` | `(transcription: TranscriptionEvent)` | `TranscriptionEvent \| null` |
| `before:llm` | `({ messages: Message[], systemPrompt: string })` | `{ messages, systemPrompt } \| null` |
| `after:llm` | `(response: string)` | `string \| null` |
| `before:tts` | `(text: string)` | `string \| null` |
| `after:tts` | `(audioBuffer: Buffer)` | `Buffer \| null` |

**Example:**

```ts
// Filter profanity from responses
agent.use('after:llm', (response) => {
  return response.replace(/badword/gi, '***')
})

// Skip empty transcriptions
agent.use('after:stt', (transcription) => {
  if (transcription.text.trim().length < 3) return null
  return transcription
})

// Inject context into every LLM call
agent.use('before:llm', ({ messages, systemPrompt }) => {
  return {
    messages,
    systemPrompt: systemPrompt + '\nCurrent time: ' + new Date().toISOString(),
  }
})
```

## Events

Subscribe to events using `agent.on(event, listener)`.

| Event | Payload | Description |
|-------|---------|-------------|
| `transcription` | [`TranscriptionEvent`](./configuration.md#transcriptionevent) | Someone spoke and their speech was transcribed |
| `response` | [`ResponseEvent`](./configuration.md#responseevent) | The agent generated and spoke a response |
| `status` | [`AgentStatus`](./configuration.md#agentstatus) | Agent status changed |
| `error` | `Error` | An error occurred (auth failure, API error, etc.) |
| `speaker-joined` | [`SpeakerEvent`](./configuration.md#speakerevent) | A speaker joined the Space |
| `speaker-left` | [`SpeakerEvent`](./configuration.md#speakerevent) | A speaker left the Space |
| `space-ended` | *(none)* | The X Space has ended |
| `audio-chunk` | `Float32Array` | Raw audio chunk from the Space (for advanced usage) |

**Example:**

```ts
agent.on('transcription', ({ speaker, text, timestamp }) => {
  console.log(`[${new Date(timestamp).toLocaleTimeString()}] ${speaker}: ${text}`)
})

agent.on('status', (status) => {
  console.log(`Agent status: ${status}`)
})

agent.on('error', (err) => {
  console.error('Agent error:', err.message)
})

agent.on('space-ended', () => {
  console.log('Space has ended, cleaning up...')
  agent.destroy()
})
```

## Lifecycle Diagram

```
disconnected
    │
    ▼  join()
launching
    │
    ▼
logging-in
    │
    ▼
logged-in ◄──── leave()
    │
    ▼
joining
    │
    ▼
  idle ◄──────── (after speaking/listening)
    │
    ├──► speaking ──► idle
    │
    ├──► listening ──► idle
    │
    ▼
space-ended      (detected by health check)
    │
    ▼  destroy()
disconnected
```


