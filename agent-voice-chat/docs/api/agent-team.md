# AgentTeam

Manage multiple AI agents in a single X Space. All agents share one browser session and STT provider, but each has its own LLM and TTS configuration. A turn management system coordinates which agent responds.

Extends `EventEmitter`.

```ts
import { AgentTeam } from 'xspace-agent'
```

## Constructor

```ts
new AgentTeam(config: AgentTeamConfig)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `config` | [`AgentTeamConfig`](./configuration.md#agentteamconfig) | Yes | Team configuration |

The constructor initializes a shared STT provider (inferred from the first agent's AI config), creates LLM and TTS instances for each agent, and sets up the VAD.

**Example:**

```ts
import { AgentTeam } from 'xspace-agent'

const team = new AgentTeam({
  auth: { token: process.env.X_AUTH_TOKEN, ct0: process.env.X_CT0 },
  agents: [
    {
      name: 'Historian',
      ai: {
        provider: 'claude',
        apiKey: process.env.ANTHROPIC_API_KEY,
        systemPrompt: 'You are a history expert. Keep answers under 30 seconds.',
      },
      voice: { provider: 'elevenlabs', apiKey: process.env.EL_KEY, voiceId: 'VR6AewLTigWG4xSOukaG' },
    },
    {
      name: 'Scientist',
      ai: {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        systemPrompt: 'You are a science expert. Keep answers under 30 seconds.',
      },
      voice: { provider: 'openai', apiKey: process.env.OPENAI_API_KEY, voiceId: 'nova' },
    },
  ],
  turnManagement: { strategy: 'round-robin', turnDelay: 500 },
})
```

## Methods

### join(spaceUrl)

```ts
async join(spaceUrl: string): Promise<void>
```

Launch a browser, log in, join the Space, and request speaker access. All agents are set to `idle` once connected.

| Parameter | Type | Description |
|-----------|------|-------------|
| `spaceUrl` | `string` | Full URL of the X Space |

**Throws:** `Error` if the team is already running (call `destroy()` first).

---

### destroy()

```ts
async destroy(): Promise<void>
```

Leave the Space, close the browser, destroy the VAD, and remove all listeners. The team cannot be reused after calling `destroy()`.

## Events

| Event | Payload | Description |
|-------|---------|-------------|
| `transcription` | `TranscriptionEvent & { respondingAgent: { name: string, id: number } }` | Someone spoke; includes which agent will respond |
| `response` | [`ResponseEvent`](./configuration.md#responseevent) | An agent generated and spoke a response |
| `error` | `Error` | An error occurred |
| `space-ended` | *(none)* | The X Space has ended |

The `transcription` event extends the standard [`TranscriptionEvent`](./configuration.md#transcriptionevent) with a `respondingAgent` field indicating which team member was selected to respond.

**Example:**

```ts
team.on('transcription', ({ speaker, text, respondingAgent }) => {
  console.log(`${speaker}: ${text}`)
  console.log(`  → ${respondingAgent.name} will respond`)
})

team.on('response', ({ text }) => {
  console.log(`Agent: ${text}`)
})

team.on('space-ended', async () => {
  await team.destroy()
})
```

## Turn Management Strategies

The `turnManagement.strategy` option controls how agents take turns:

| Strategy | Behavior |
|----------|----------|
| `'queue'` | The first idle agent responds. Agents that haven't spoken recently are preferred. **(default)** |
| `'round-robin'` | Agents respond in sequential order, cycling through the list. |
| `'director'` | Reserved for future use. Currently falls back to round-robin. |

The `turnDelay` option (default: `500`ms) adds a pause between agent turns to prevent overlapping speech.

### How Turn Locking Works

1. When speech is detected, the team selects an agent based on the strategy.
2. The selected agent requests a turn lock. If the lock is available, it proceeds.
3. If another agent is currently speaking, the request is queued.
4. After an agent finishes speaking, the lock is released and the next queued agent (if any) gets the lock after `turnDelay` milliseconds.


