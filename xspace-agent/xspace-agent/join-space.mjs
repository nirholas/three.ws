/**
 * Quick test: join an X Space, request to speak, unmute, and respond with OpenAI TTS.
 *
 * Usage:
 *   node join-space.mjs https://x.com/i/spaces/SPACE_ID
 *
 * Requires .env to be loaded (uses dotenv if available, otherwise reads process.env)
 */

import { createRequire } from 'module'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load .env manually
try {
  const envContent = readFileSync(path.join(__dirname, '.env'), 'utf8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
  console.log('[env] Loaded .env file')
} catch {
  console.log('[env] No .env file found, using existing environment')
}

const spaceUrl = process.argv[2]
if (!spaceUrl) {
  console.error('Usage: node join-space.mjs <space-url>')
  console.error('Example: node join-space.mjs https://x.com/i/spaces/1vAxRkbnWleKl')
  process.exit(1)
}

// Validate required env vars
const required = { X_AUTH_TOKEN: process.env.X_AUTH_TOKEN, OPENAI_API_KEY: process.env.OPENAI_API_KEY }
for (const [key, val] of Object.entries(required)) {
  if (!val) { console.error(`Missing required env var: ${key}`); process.exit(1) }
}

console.log('[agent] Loading XSpaceAgent...')

// Import from compiled dist
const { XSpaceAgent, SpaceNotFoundError, AuthenticationError } = await import('./packages/core/dist/index.js')

const agent = new XSpaceAgent({
  auth: {
    token: process.env.X_AUTH_TOKEN,
    ct0: process.env.X_CT0,
  },
  ai: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY,
    systemPrompt: 'You are a friendly AI assistant in an X Space. Keep your responses concise — under 2 sentences.',
  },
  voice: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    voiceId: 'alloy', // OpenAI TTS voices: alloy, echo, fable, onyx, nova, shimmer
  },
  behavior: {
    silenceThreshold: 1.5,
    autoRespond: true, // automatically respond when spoken to
  },
})

agent.on('status', (s) => console.log(`[status] ${s}`))
agent.on('transcription', ({ speaker, text }) => console.log(`[transcription] ${speaker}: ${text}`))
agent.on('response', ({ text }) => console.log(`[agent spoke] ${text}`))
agent.on('error', (err) => console.error(`[error] ${err?.message || err}`))
agent.on('space-ended', () => {
  console.log('[agent] Space ended. Exiting.')
  process.exit(0)
})

console.log(`[agent] Joining Space: ${spaceUrl}`)
console.log('[agent] Will request to speak, wait for approval, then unmute and respond via OpenAI TTS')

try {
  await agent.join(spaceUrl)
  console.log('[agent] Successfully joined! Listening for speakers...')
} catch (err) {
  if (err instanceof SpaceNotFoundError) {
    console.error('[error] Space not found — is it still live?')
  } else if (err instanceof AuthenticationError) {
    console.error('[error] Auth failed:', err.hint || err.message)
    console.error('[hint] Check X_AUTH_TOKEN and X_CT0 in your .env')
  } else {
    console.error('[error] Failed to join:', err?.message || err)
  }
  process.exit(1)
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[agent] Leaving Space...')
  await agent.leave().catch(() => {})
  process.exit(0)
})


