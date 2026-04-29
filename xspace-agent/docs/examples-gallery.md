# Prompt: Examples Gallery

## Why
Examples are the #1 way people evaluate a project. Every viral open-source project has an `examples/` directory that shows "here's what you can build in 20 lines." Examples also serve as integration tests and documentation.

## Examples to Build

### 1. `examples/basic-join/` — Hello World
The absolute minimum. This goes in the README.

```typescript
// index.ts — 15 lines
import { XSpaceAgent } from 'xspace-agent'

const agent = new XSpaceAgent({
  auth: { token: process.env.X_AUTH_TOKEN! },
  ai: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY!,
    systemPrompt: 'You are a friendly AI assistant. Keep responses under 2 sentences.'
  }
})

await agent.join(process.argv[2]) // pass Space URL as argument

agent.on('transcription', ({ speaker, text }) => console.log(`${speaker}: ${text}`))
agent.on('response', ({ text }) => console.log(`Agent: ${text}`))
process.on('SIGINT', () => agent.leave())
```

```json
// package.json
{
  "name": "xspace-basic-example",
  "type": "module",
  "scripts": { "start": "tsx index.ts" },
  "dependencies": { "xspace-agent": "latest", "tsx": "latest" }
}
```

```
# README.md
## Basic Join Example
1. `npm install`
2. `X_AUTH_TOKEN=xxx OPENAI_API_KEY=xxx npm start https://x.com/i/spaces/...`
```

---

### 2. `examples/transcription-logger/` — Listen Only
Join a Space and save a transcript to file. No AI responses.

```typescript
import { XSpaceAgent } from 'xspace-agent'
import { appendFileSync } from 'fs'

const agent = new XSpaceAgent({
  auth: { token: process.env.X_AUTH_TOKEN! },
  ai: {
    provider: 'openai', // needed for STT
    apiKey: process.env.OPENAI_API_KEY!,
    systemPrompt: '' // not used
  },
  behavior: { autoRespond: false } // listen only
})

await agent.join(process.argv[2])

agent.on('transcription', ({ speaker, text, timestamp }) => {
  const line = `[${timestamp.toISOString()}] ${speaker}: ${text}\n`
  process.stdout.write(line)
  appendFileSync('transcript.txt', line)
})

process.on('SIGINT', async () => {
  await agent.leave()
  console.log('Transcript saved to transcript.txt')
})
```

---

### 3. `examples/multi-agent-debate/` — Two Agents Debating
Two agents with opposing viewpoints debate in a Space.

```typescript
import { AgentTeam } from 'xspace-agent'

const team = new AgentTeam({
  auth: { token: process.env.X_AUTH_TOKEN! },
  agents: [
    {
      name: 'Bull',
      ai: {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY!,
        systemPrompt: `You are "Bull", an optimistic tech investor. You see opportunity everywhere.
          When the other agent speaks, challenge their pessimism with data and enthusiasm.
          Keep responses to 1-2 sentences.`
      },
      voice: { provider: 'openai', voiceId: 'alloy' }
    },
    {
      name: 'Bear',
      ai: {
        provider: 'claude',
        apiKey: process.env.ANTHROPIC_API_KEY!,
        systemPrompt: `You are "Bear", a cautious analyst. You see risk everywhere.
          When the other agent speaks, point out flaws and risks.
          Keep responses to 1-2 sentences.`
      },
      voice: { provider: 'openai', voiceId: 'echo' }
    }
  ],
  turnManagement: { strategy: 'round-robin', turnDelay: 2000 }
})

await team.join(process.argv[2])
```

---

### 4. `examples/custom-provider/` — Bring Your Own AI
Shows how to use a local LLM or custom API.

```typescript
import { XSpaceAgent, CustomProvider } from 'xspace-agent'

// Example: Ollama local model
const ollamaProvider: CustomProvider = {
  type: 'socket',
  async generateResponse({ messages, systemPrompt }) {
    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        model: 'llama3',
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages
        ],
        stream: false
      })
    })
    const data = await res.json()
    return data.message.content
  }
}

const agent = new XSpaceAgent({
  auth: { token: process.env.X_AUTH_TOKEN! },
  ai: {
    provider: 'custom',
    systemPrompt: 'You are a helpful assistant running on a local LLM.',
    custom: ollamaProvider
  }
})

await agent.join(process.argv[2])
```

---

### 5. `examples/discord-bridge/` — Discord Bot Controls the Agent
A Discord bot that lets moderators control the X Space agent from Discord.

```typescript
import { Client, GatewayIntentBits } from 'discord.js'
import { XSpaceAgent } from 'xspace-agent'

const discord = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] })
const agent = new XSpaceAgent({ /* config */ })

discord.on('messageCreate', async (msg) => {
  if (!msg.member?.permissions.has('Administrator')) return

  if (msg.content.startsWith('!join ')) {
    const url = msg.content.split(' ')[1]
    await agent.join(url)
    msg.reply(`Joined Space: ${url}`)
  }

  if (msg.content === '!leave') {
    await agent.leave()
    msg.reply('Left Space')
  }

  if (msg.content.startsWith('!say ')) {
    const text = msg.content.slice(5)
    await agent.say(text)
    msg.reply(`Said: "${text}"`)
  }

  if (msg.content === '!status') {
    const status = agent.getStatus()
    msg.reply(`Status: ${status}`)
  }
})

// Forward transcriptions to Discord channel
agent.on('transcription', ({ speaker, text }) => {
  const channel = discord.channels.cache.get('CHANNEL_ID')
  channel?.send(`**${speaker}**: ${text}`)
})

discord.login(process.env.DISCORD_TOKEN)
```

---

### 6. `examples/middleware-pipeline/` — Custom Processing Pipeline
Shows middleware hooks for content filtering, translation, etc.

```typescript
import { XSpaceAgent } from 'xspace-agent'

const agent = new XSpaceAgent({ /* config */ })

// Noise filter: ignore very short utterances
agent.use('after:stt', (transcription) => {
  if (transcription.text.split(' ').length < 3) return null // skip
  return transcription
})

// Translate: respond in the language of the speaker
agent.use('before:llm', async (messages, systemPrompt) => {
  const lastMsg = messages[messages.length - 1]
  const lang = await detectLanguage(lastMsg.content)
  if (lang !== 'en') {
    systemPrompt += `\nRespond in ${lang}.`
  }
  return { messages, systemPrompt }
})

// Safety filter: remove sensitive content
agent.use('after:llm', (response) => {
  return response.replace(/specific-thing/gi, '[redacted]')
})

// Analytics: log every response
agent.use('after:tts', (audioBuffer) => {
  logResponseMetrics({ size: audioBuffer.length, timestamp: Date.now() })
  return audioBuffer
})

await agent.join(process.argv[2])
```

---

### 7. `examples/express-integration/` — Embed in Existing Express App
Shows how to add the agent as a feature in an existing web app.

```typescript
import express from 'express'
import { XSpaceAgent } from 'xspace-agent'
import { createServer as createAgentServer } from 'xspace-agent/server'

const app = express()

// Your existing routes
app.get('/', (req, res) => res.send('My App'))
app.get('/api/users', (req, res) => { /* ... */ })

// Mount the X Space agent admin panel at /agent
const { router, io } = createAgentServer({
  agent: new XSpaceAgent({ /* config */ }),
  basePath: '/agent'
})
app.use('/agent', router)

// Now your app has:
// - /agent/admin → admin panel
// - /agent/api/status → agent status
// - Your existing routes still work

const server = app.listen(3000)
io.attach(server) // Socket.IO shares the same server
```

---

### 8. `examples/scheduled-spaces/` — Cron-Based Space Joining
Join specific Spaces on a schedule.

```typescript
import { XSpaceAgent } from 'xspace-agent'
import cron from 'node-cron'

const agent = new XSpaceAgent({ /* config */ })

// Join crypto morning show every weekday at 9 AM ET
cron.schedule('0 9 * * 1-5', async () => {
  console.log('Joining morning show...')
  await agent.join('https://x.com/i/spaces/morning-show-url')

  // Auto-leave after 1 hour
  setTimeout(() => agent.leave(), 60 * 60 * 1000)
}, { timezone: 'America/New_York' })

// Join weekly AMA every Friday at 6 PM
cron.schedule('0 18 * * 5', async () => {
  await agent.join('https://x.com/i/spaces/ama-url')
  setTimeout(() => agent.leave(), 2 * 60 * 60 * 1000)
}, { timezone: 'America/New_York' })

console.log('Scheduler running. Waiting for next scheduled Space...')
```

## Each Example Must Have
1. `package.json` with name, deps, and start script
2. `README.md` with 3-step quickstart
3. `.env.example` with required vars
4. Actual working code (not pseudocode)

## Implementation Steps
1. Create `examples/` directory in monorepo
2. Build basic-join first (prove the SDK API works)
3. Build each example, testing against the actual SDK
4. Add each example to the main README as a showcase
5. Ensure all examples work with `npm install && npm start`

## Validation
- [ ] Every example has package.json, README, .env.example
- [ ] Every example runs with `npm start` (given proper env vars)
- [ ] basic-join works end-to-end
- [ ] custom-provider works with Ollama
- [ ] All examples use only the public SDK API (no internal imports)


