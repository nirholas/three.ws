# Getting Started with xspace-agent

Get an AI voice agent into an X Space in under 5 minutes.

## Prerequisites

- **Node.js 18+** (check with `node -v`)
- An **X (Twitter) account** that can access Spaces
- An **OpenAI API key** (or Anthropic/Groq -- any supported LLM provider works)

## Installation

```bash
npm install xspace-agent
```

If you are starting a fresh project:

```bash
mkdir my-agent && cd my-agent
npm init -y
npm install xspace-agent tsx
```

## Authentication

The agent needs to log into X on your behalf. There are two methods.

### Cookie auth (recommended)

This is the most reliable approach -- no CAPTCHAs, no 2FA prompts.

1. Open **x.com** in your browser and log in.
2. Open DevTools (`F12` or `Cmd+Option+I`).
3. Go to **Application** > **Cookies** > `https://x.com`.
4. Copy the values for `auth_token` and `ct0`.
5. Set them as environment variables:

```bash
export X_AUTH_TOKEN="your_auth_token_value"
export X_CT0="your_ct0_value"
```

### Username and password

```bash
export X_USERNAME="your_handle"
export X_PASSWORD="your_password"
```

> **Note:** Username/password login may trigger 2FA or CAPTCHA challenges. If you have 2FA enabled, cookie auth is strongly recommended.

## Your First Agent

Create a file called `agent.ts`:

```typescript
import { XSpaceAgent } from 'xspace-agent'

const agent = new XSpaceAgent({
  // Authenticate with X using cookies from your browser
  auth: {
    token: process.env.X_AUTH_TOKEN!,
    ct0: process.env.X_CT0!,
  },
  // Configure the LLM that powers your agent's responses
  ai: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
    systemPrompt: 'You are a friendly AI assistant in an X Space. Keep responses under 2 sentences.',
  },
})

// Log lifecycle changes (joining, listening, speaking, etc.)
agent.on('status', (status) => console.log('Status:', status))

// Log transcribed speech from other speakers
agent.on('transcription', ({ speaker, text }) => {
  console.log(`[${speaker}]: ${text}`)
})

// Log the agent's own responses
agent.on('response', ({ text }) => console.log(`[Agent]: ${text}`))

// Handle errors
agent.on('error', (err) => console.error('Error:', err))

// Clean up when the Space ends
agent.on('space-ended', () => {
  console.log('Space ended.')
  process.exit(0)
})

// Join the Space (pass the URL as a CLI argument)
const spaceUrl = process.argv[2]
if (!spaceUrl) {
  console.error('Usage: npx tsx agent.ts <space-url>')
  process.exit(1)
}

await agent.join(spaceUrl)
console.log('Agent is live!')

// Graceful shutdown on Ctrl+C
process.on('SIGINT', async () => {
  console.log('\nLeaving Space...')
  await agent.leave()
  process.exit(0)
})
```

### What each part does

| Line(s) | Purpose |
|---------|---------|
| `new XSpaceAgent({...})` | Creates the agent with auth credentials and AI config. |
| `auth.token` / `auth.ct0` | X session cookies so the agent can log in. |
| `ai.provider` + `ai.apiKey` | Selects which LLM generates responses (OpenAI, Claude, or Groq). |
| `ai.systemPrompt` | Defines the agent's personality and behavior. |
| `agent.on('transcription', ...)` | Fires every time someone speaks and their audio is transcribed. |
| `agent.on('response', ...)` | Fires when the agent generates a response and speaks it in the Space. |
| `agent.join(url)` | Launches a headless browser, logs into X, joins the Space, and starts listening. |
| `agent.leave()` | Gracefully leaves the Space and closes the browser. |

## Running It

Make sure your environment variables are set, then:

```bash
export OPENAI_API_KEY="sk-..."
npx tsx agent.ts https://x.com/i/spaces/YOUR_SPACE_ID
```

You should see output like:

```
Status: launching
Status: authenticating
Status: joining
Status: listening
Agent is live!
[SomeSpeaker]: Hey, is anyone there?
[Agent]: Hi there! I'm an AI assistant -- happy to chat.
```

The agent will automatically:
1. Launch a headless Chromium browser
2. Log into X with your credentials
3. Join the Space and request speaker access
4. Transcribe what other speakers say (via Whisper)
5. Generate responses with your chosen LLM
6. Speak them aloud in the Space (via TTS)

Press `Ctrl+C` to leave the Space and shut down.

### Using a different LLM provider

Swap `provider` and `apiKey` to use Claude or Groq instead:

```typescript
// Claude
ai: {
  provider: 'claude',
  apiKey: process.env.ANTHROPIC_API_KEY!,
  systemPrompt: 'You are a witty podcast host.',
}

// Groq (fast and cheap)
ai: {
  provider: 'groq',
  apiKey: process.env.GROQ_API_KEY!,
  systemPrompt: 'You are a helpful assistant.',
}
```

## Next Steps

- **[Providers Guide](providers.md)** -- configure LLM, STT, and TTS providers in detail
- **[Examples Gallery](examples-gallery.md)** -- 10+ runnable examples including multi-agent debates, Discord bridges, and scheduled Spaces
- **[Agent & Team API Reference](api/agent-team.md)** -- full API docs for `XSpaceAgent` and `AgentTeam`
- **[Docker Deployment](docker-deployment.md)** -- run your agent in production with Docker
- **[Plugin System](plugin-system.md)** -- extend agent behavior with middleware and plugins
- **[Environment Variables Reference](env-vars-reference.md)** -- full list of all configuration options


