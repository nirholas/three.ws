// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

import { XSpaceAgent } from 'xspace-agent'
import { appendFileSync } from 'fs'

const OUTPUT_FILE = process.env.OUTPUT_FILE || 'transcript.txt'

const agent = new XSpaceAgent({
  auth: { token: process.env.X_AUTH_TOKEN! },
  ai: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
    systemPrompt: ''
  },
  behavior: { autoRespond: false }
})

const spaceUrl = process.argv[2]
if (!spaceUrl) {
  console.error('Usage: npm start <space-url>')
  process.exit(1)
}

await agent.join(spaceUrl)
console.log(`Joined Space. Logging transcript to ${OUTPUT_FILE}...\n`)

agent.on('transcription', ({ speaker, text, timestamp }) => {
  const line = `[${timestamp.toISOString()}] ${speaker}: ${text}\n`
  process.stdout.write(line)
  appendFileSync(OUTPUT_FILE, line)
})

agent.on('speakerJoined', ({ name }) => {
  const line = `[${new Date().toISOString()}] --- ${name} joined ---\n`
  process.stdout.write(line)
  appendFileSync(OUTPUT_FILE, line)
})

agent.on('speakerLeft', ({ name }) => {
  const line = `[${new Date().toISOString()}] --- ${name} left ---\n`
  process.stdout.write(line)
  appendFileSync(OUTPUT_FILE, line)
})

process.on('SIGINT', async () => {
  await agent.destroy()
  console.log(`\nTranscript saved to ${OUTPUT_FILE}`)
  process.exit(0)
})


