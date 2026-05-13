// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

/**
 * Chrome Connect mode: use your own logged-in Chrome browser.
 *
 * This avoids automated login entirely — just connect to a Chrome
 * instance where you're already logged into X.com.
 *
 * Setup:
 *   1. Launch Chrome with remote debugging:
 *      google-chrome --remote-debugging-port=9222
 *   2. Log into X.com in that Chrome window
 *   3. Run this script:
 *      ANTHROPIC_API_KEY=... npx tsx index.ts https://x.com/i/spaces/abc123
 */
import { XSpaceAgent } from 'xspace-agent'

const spaceUrl = process.argv[2]
if (!spaceUrl) {
  console.error('Usage: npx tsx index.ts <space-url>')
  console.error('')
  console.error('Make sure Chrome is running with --remote-debugging-port=9222')
  console.error('and you are logged into X.com in that browser.')
  process.exit(1)
}

// In connect mode, no auth credentials are needed —
// the agent uses your existing browser session.
const agent = new XSpaceAgent({
  auth: {},
  ai: {
    provider: 'claude',
    model: 'claude-sonnet-4-20250514',
    apiKey: process.env.ANTHROPIC_API_KEY!,
    systemPrompt: 'You are a witty podcast host. Keep responses under 2 sentences.',
  },
  browser: {
    mode: 'connect',
    cdpPort: 9222,
  },
})

agent.on('status', (status) => console.log('Status:', status))
agent.on('transcription', ({ speaker, text }) => console.log(`[${speaker}]: ${text}`))
agent.on('response', ({ text }) => console.log(`[Agent]: ${text}`))
agent.on('error', (err) => console.error('Error:', err.toString()))

await agent.join(spaceUrl)
console.log('Connected to your Chrome and joined the Space!')

process.on('SIGINT', async () => {
  await agent.leave()
  process.exit(0)
})


