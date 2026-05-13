// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§67]

import { XSpaceAgent } from 'xspace-agent'
import cron from 'node-cron'

const agent = new XSpaceAgent({
  auth: { token: process.env.X_AUTH_TOKEN! },
  ai: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY!,
    systemPrompt: 'You are a helpful AI assistant. Keep responses concise and on-topic.'
  }
})

// Track whether the agent is currently in a Space
let currentSpace: string | null = null

async function joinSpace(name: string, url: string, durationMs: number) {
  if (currentSpace) {
    console.log(`[scheduler] Already in a Space, skipping "${name}"`)
    return
  }

  console.log(`[scheduler] Joining "${name}" — ${url}`)
  currentSpace = name

  try {
    await agent.join(url)
    console.log(`[scheduler] Joined "${name}". Will auto-leave in ${durationMs / 60_000} minutes.`)

    setTimeout(async () => {
      console.log(`[scheduler] Auto-leaving "${name}"`)
      await agent.destroy()
      currentSpace = null
    }, durationMs)
  } catch (err) {
    console.error(`[scheduler] Failed to join "${name}":`, (err as Error).message)
    currentSpace = null
  }
}

// ---------------------------------------------------------------------------
// Schedule definitions
// ---------------------------------------------------------------------------

// Join the crypto morning show every weekday at 9:00 AM ET, stay for 1 hour
cron.schedule('0 9 * * 1-5', () => {
  joinSpace(
    'Crypto Morning Show',
    process.env.MORNING_SHOW_URL || 'https://x.com/i/spaces/morning-show',
    60 * 60 * 1000 // 1 hour
  )
}, { timezone: 'America/New_York' })

// Join the weekly AMA every Friday at 6:00 PM ET, stay for 2 hours
cron.schedule('0 18 * * 5', () => {
  joinSpace(
    'Weekly AMA',
    process.env.AMA_URL || 'https://x.com/i/spaces/weekly-ama',
    2 * 60 * 60 * 1000 // 2 hours
  )
}, { timezone: 'America/New_York' })

// Join the Sunday recap every Sunday at 3:00 PM ET, stay for 1.5 hours
cron.schedule('0 15 * * 0', () => {
  joinSpace(
    'Sunday Recap',
    process.env.SUNDAY_RECAP_URL || 'https://x.com/i/spaces/sunday-recap',
    90 * 60 * 1000 // 1.5 hours
  )
}, { timezone: 'America/New_York' })

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
agent.on('transcription', ({ speaker, text }) => console.log(`[${currentSpace}] ${speaker}: ${text}`))
agent.on('response', ({ text }) => console.log(`[${currentSpace}] Agent: ${text}`))

console.log('Scheduler running. Scheduled Spaces:')
console.log('  Mon-Fri 9:00 AM ET — Crypto Morning Show (1h)')
console.log('  Friday  6:00 PM ET — Weekly AMA (2h)')
console.log('  Sunday  3:00 PM ET — Sunday Recap (1.5h)')
console.log('\nWaiting for next scheduled Space...')

// Keep the process alive
process.on('SIGINT', async () => {
  if (currentSpace) {
    console.log(`\nLeaving "${currentSpace}"...`)
    await agent.destroy()
  }
  process.exit(0)
})


