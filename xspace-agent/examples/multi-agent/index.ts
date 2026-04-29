// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

import { AgentTeam } from 'xspace-agent'

const team = new AgentTeam({
  auth: { token: process.env.X_AUTH_TOKEN! },
  agents: [
    {
      name: 'Bob',
      ai: {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        systemPrompt: 'You are Bob, a crypto expert. You are energetic and opinionated. Keep responses under 2 sentences.',
      },
      voice: {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        voiceId: 'onyx',
      },
    },
    {
      name: 'Alice',
      ai: {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        systemPrompt: 'You are Alice, a tech analyst. You are calm and analytical. Keep responses under 2 sentences.',
      },
      voice: {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        voiceId: 'nova',
      },
    },
  ],
  turnManagement: {
    strategy: 'round-robin',
    turnDelay: 500,
  },
})

const spaceUrl = process.argv[2]
if (!spaceUrl) {
  console.error('Usage: npm start <space-url>')
  process.exit(1)
}

await team.join(spaceUrl)

team.on('transcription', (data: any) => {
  console.log(`${data.speaker}: ${data.text} → ${data.respondingAgent?.name} responding`)
})

team.on('response', ({ text }) => {
  console.log(`Agent: ${text}`)
})

team.on('error', (err) => {
  console.error('Error:', err.message)
})

process.on('SIGINT', () => team.destroy())


