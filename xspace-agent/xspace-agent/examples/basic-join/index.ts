// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

/**
 * Basic example: join a Space and respond to speakers.
 *
 * Usage:
 *   X_AUTH_TOKEN=... OPENAI_API_KEY=... npx tsx index.ts https://x.com/i/spaces/abc123
 */
import {
  XSpaceAgent,
  SpaceNotFoundError,
  AuthenticationError,
} from 'xspace-agent'

const spaceUrl = process.argv[2]
if (!spaceUrl) {
  console.error('Usage: npx tsx index.ts <space-url>')
  process.exit(1)
}

const agent = new XSpaceAgent({
  auth: { token: process.env.X_AUTH_TOKEN! },
  ai: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY!,
    systemPrompt: 'You are a friendly AI assistant. Keep responses under 2 sentences.',
  },
})

// Listen for events
agent.on('status', (status) => console.log('Status:', status))
agent.on('transcription', ({ speaker, text }) => console.log(`[${speaker}]: ${text}`))
agent.on('response', ({ text }) => console.log(`[Agent]: ${text}`))
agent.on('error', (err) => console.error('Error:', err.toString()))
agent.on('space-ended', () => {
  console.log('Space ended.')
  process.exit(0)
})

// Join with error handling
try {
  await agent.join(spaceUrl)
  console.log('Agent is live in the Space!')
} catch (err) {
  if (err instanceof SpaceNotFoundError) {
    console.error('Space not found — is it still live?')
  } else if (err instanceof AuthenticationError) {
    console.error('Auth failed:', err.hint)
  } else {
    console.error('Failed to join:', err)
  }
  process.exit(1)
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nLeaving Space...')
  await agent.leave()
  process.exit(0)
})


