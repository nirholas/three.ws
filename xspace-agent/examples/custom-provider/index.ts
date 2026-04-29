// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import { XSpaceAgent } from 'xspace-agent'
import type { CustomProvider } from 'xspace-agent'

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3'

// Example: Ollama local model
const ollamaProvider: CustomProvider = {
  type: 'socket',
  async generateResponse({ messages, systemPrompt }) {
    const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
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
  },
  voice: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY
  }
})

const spaceUrl = process.argv[2]
if (!spaceUrl) {
  console.error('Usage: npm start <space-url>')
  process.exit(1)
}

await agent.join(spaceUrl)
console.log(`Joined Space with ${OLLAMA_MODEL} via Ollama at ${OLLAMA_HOST}`)

agent.on('transcription', ({ speaker, text }) => console.log(`${speaker}: ${text}`))
agent.on('response', ({ text }) => console.log(`Agent: ${text}`))

process.on('SIGINT', async () => {
  await agent.destroy()
  process.exit(0)
})


