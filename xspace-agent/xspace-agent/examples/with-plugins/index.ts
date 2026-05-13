// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

/**
 * Plugin example: extend agent behavior with custom hooks.
 *
 * Demonstrates two inline plugins:
 *   1. File logger — writes all transcriptions to a log file
 *   2. Response filter — limits response length
 *
 * Usage:
 *   X_AUTH_TOKEN=... OPENAI_API_KEY=... npx tsx index.ts https://x.com/i/spaces/abc123
 */
import fs from 'fs/promises'
import { XSpaceAgent } from 'xspace-agent'
import type { Plugin } from 'xspace-agent'

// --- Plugin 1: File Logger ---
// Logs all transcriptions and responses to a file on disk.
const fileLoggerPlugin: Plugin = {
  name: 'file-logger',
  version: '1.0.0',
  description: 'Logs all conversation to conversation.log',

  async onTranscription(result) {
    const line = `[${new Date().toISOString()}] ${result.speaker}: ${result.text}\n`
    await fs.appendFile('conversation.log', line)
    return result // pass through unmodified
  },

  async onResponse(text) {
    const line = `[${new Date().toISOString()}] Agent: ${text}\n`
    await fs.appendFile('conversation.log', line)
    return text
  },
}

// --- Plugin 2: Response Length Limiter ---
// Truncates responses that exceed a character limit.
function createLengthLimiter(maxChars: number): Plugin {
  return {
    name: 'length-limiter',
    version: '1.0.0',
    description: `Limits responses to ${maxChars} characters`,

    async onResponse(text) {
      if (text.length > maxChars) {
        // Find the last sentence boundary within the limit
        const truncated = text.slice(0, maxChars)
        const lastPeriod = truncated.lastIndexOf('.')
        return lastPeriod > 0 ? truncated.slice(0, lastPeriod + 1) : truncated
      }
      return text
    },
  }
}

// --- Main ---

const spaceUrl = process.argv[2]
if (!spaceUrl) {
  console.error('Usage: npx tsx index.ts <space-url>')
  process.exit(1)
}

const agent = new XSpaceAgent({
  auth: { token: process.env.X_AUTH_TOKEN! },
  ai: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY!,
    systemPrompt: 'You are a helpful AI assistant participating in an X Space.',
  },
  plugins: [
    fileLoggerPlugin,
    createLengthLimiter(280), // Twitter-length responses
  ],
})

agent.on('transcription', ({ speaker, text }) => console.log(`[${speaker}]: ${text}`))
agent.on('response', ({ text }) => console.log(`[Agent]: ${text}`))
agent.on('error', (err) => console.error('Error:', err.toString()))

await agent.join(spaceUrl)
console.log('Agent joined with plugins:', agent.getPlugins().map((p) => p.name).join(', '))

process.on('SIGINT', async () => {
  await agent.leave()
  process.exit(0)
})


