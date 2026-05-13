#!/usr/bin/env npx tsx
// Quick-start script: Join an X Space → listen → respond with AI
//
// Usage:
//   1. Copy .env.example to .env and fill in X_AUTH_TOKEN + OPENAI_API_KEY
//   2. pnpm install
//   3. npx tsx run-agent.ts https://x.com/i/spaces/YOUR_SPACE_ID
//
// For connect mode (recommended for dev — no auth needed):
//   1. Launch Chrome: google-chrome --remote-debugging-port=9222
//   2. Log into x.com manually in that Chrome
//   3. Set BROWSER_MODE=connect in .env
//   4. npx tsx run-agent.ts https://x.com/i/spaces/YOUR_SPACE_ID

import 'dotenv/config'
import { XSpaceAgent } from './packages/core/src/index'

const spaceUrl = process.argv[2]
if (!spaceUrl) {
  console.error('Usage: npx tsx run-agent.ts <space-url>')
  console.error('  e.g. npx tsx run-agent.ts https://x.com/i/spaces/1ZkKzmBGWjwGv')
  process.exit(1)
}

// Validate required env vars
const authToken = process.env.X_AUTH_TOKEN
const username = process.env.X_USERNAME
const password = process.env.X_PASSWORD
const browserMode = (process.env.BROWSER_MODE || 'managed') as 'managed' | 'connect'

if (browserMode === 'managed' && !authToken && !username) {
  console.error('Error: Set X_AUTH_TOKEN (or X_USERNAME + X_PASSWORD) in .env')
  console.error('  Or use BROWSER_MODE=connect with an already-logged-in Chrome')
  process.exit(1)
}

const openaiKey = process.env.OPENAI_API_KEY
if (!openaiKey) {
  console.error('Error: Set OPENAI_API_KEY in .env')
  process.exit(1)
}

// Build auth config
const auth = authToken
  ? { token: authToken, ct0: process.env.X_CT0 }
  : { username: username!, password: password!, email: process.env.X_EMAIL }

// Build agent config
const agent = new XSpaceAgent({
  auth,
  ai: {
    provider: 'openai' as const,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    apiKey: openaiKey,
    systemPrompt:
      process.env.SYSTEM_PROMPT ||
      'You are a friendly AI assistant participating in a Twitter Space. Keep responses concise (1-2 sentences). Be conversational and engaging.',
  },
  voice: {
    provider: (process.env.TTS_PROVIDER as 'openai' | 'elevenlabs' | 'browser') || 'openai',
    apiKey: process.env.ELEVENLABS_API_KEY || openaiKey,
    voiceId: process.env.TTS_VOICE_ID,
  },
  browser: {
    mode: browserMode,
    headless: process.env.HEADLESS !== 'false',
    cdpEndpoint: process.env.CDP_ENDPOINT,
    cdpHost: process.env.CDP_HOST,
    cdpPort: process.env.CDP_PORT ? parseInt(process.env.CDP_PORT, 10) : undefined,
  },
  behavior: {
    silenceThreshold: parseFloat(process.env.SILENCE_THRESHOLD || '1.5'),
    turnDelay: parseInt(process.env.TURN_DELAY || '1500', 10),
  },
})

// Events
agent.on('status', (status) => {
  console.log(`[Status] ${status}`)
})

agent.on('transcription', (event) => {
  console.log(`[${event.speaker || 'Speaker'}]: ${event.text}`)
})

agent.on('response', (event) => {
  console.log(`[Agent]: ${event.text}`)
})

agent.on('error', (err) => {
  console.error('[Error]', err instanceof Error ? err.message : err)
})

agent.on('space-ended', () => {
  console.log('[Space ended]')
  process.exit(0)
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nLeaving Space...')
  try {
    await agent.leave()
  } catch {
    // best effort
  }
  await agent.destroy()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await agent.leave().catch(() => {})
  await agent.destroy()
  process.exit(0)
})

// Join the Space
async function main() {
  console.log(`Joining Space: ${spaceUrl}`)
  console.log(`Browser mode: ${browserMode}`)
  console.log(`AI: OpenAI ${process.env.OPENAI_MODEL || 'gpt-4o-mini'}`)
  console.log(`TTS: ${process.env.TTS_PROVIDER || 'openai'}`)
  console.log('---')

  try {
    await agent.join(spaceUrl)
    console.log('Agent is live in the Space! Listening...')
    console.log('Press Ctrl+C to leave.')
  } catch (err) {
    console.error('Failed to join:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

main()


