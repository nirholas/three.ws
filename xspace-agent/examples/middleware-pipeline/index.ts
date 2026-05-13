// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

import { XSpaceAgent } from 'xspace-agent'

const agent = new XSpaceAgent({
  auth: { token: process.env.X_AUTH_TOKEN! },
  ai: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY!,
    systemPrompt: 'You are a helpful, multilingual AI assistant. Keep responses concise.'
  }
})

// ---------------------------------------------------------------------------
// Middleware 1: Noise filter — ignore very short utterances
// ---------------------------------------------------------------------------
agent.use('after:stt', (transcription) => {
  const wordCount = transcription.text.trim().split(/\s+/).length
  if (wordCount < 3) {
    console.log(`[filter] Skipped short utterance: "${transcription.text}"`)
    return null // drop this transcription
  }
  return transcription
})

// ---------------------------------------------------------------------------
// Middleware 2: Language detection — respond in the speaker's language
// ---------------------------------------------------------------------------
agent.use('before:llm', async (messages, systemPrompt) => {
  const lastMsg = messages[messages.length - 1]
  if (!lastMsg) return { messages, systemPrompt }

  const lang = detectLanguage(lastMsg.content)
  if (lang && lang !== 'en') {
    console.log(`[i18n] Detected language: ${lang}`)
    systemPrompt += `\nIMPORTANT: Respond in ${lang}.`
  }

  return { messages, systemPrompt }
})

// ---------------------------------------------------------------------------
// Middleware 3: Safety filter — redact sensitive patterns from responses
// ---------------------------------------------------------------------------
const REDACT_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/g,             // SSN
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, // credit card
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g // email
]

agent.use('after:llm', (response) => {
  let filtered = response
  for (const pattern of REDACT_PATTERNS) {
    filtered = filtered.replace(pattern, '[REDACTED]')
  }
  if (filtered !== response) {
    console.log('[safety] Redacted sensitive content from response')
  }
  return filtered
})

// ---------------------------------------------------------------------------
// Middleware 4: Analytics — log response metrics
// ---------------------------------------------------------------------------
let responseCount = 0

agent.use('after:tts', (audioBuffer) => {
  responseCount++
  console.log(`[analytics] Response #${responseCount} | Audio size: ${audioBuffer.length} bytes | Time: ${new Date().toISOString()}`)
  return audioBuffer
})

// ---------------------------------------------------------------------------
// Simple language detection heuristic
// ---------------------------------------------------------------------------
function detectLanguage(text: string): string | null {
  const indicators: Record<string, RegExp[]> = {
    es: [/\b(hola|gracias|por favor|buenos días|cómo estás)\b/i],
    fr: [/\b(bonjour|merci|s'il vous plaît|comment allez)\b/i],
    de: [/\b(hallo|danke|bitte|wie geht|guten tag)\b/i],
    ja: [/[\u3040-\u309F\u30A0-\u30FF]/],
    zh: [/[\u4E00-\u9FFF]/],
    ko: [/[\uAC00-\uD7AF]/],
    ar: [/[\u0600-\u06FF]/],
    pt: [/\b(olá|obrigado|por favor|bom dia)\b/i],
  }

  for (const [lang, patterns] of Object.entries(indicators)) {
    if (patterns.some((p) => p.test(text))) return lang
  }
  return null
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const spaceUrl = process.argv[2]
if (!spaceUrl) {
  console.error('Usage: npm start <space-url>')
  process.exit(1)
}

await agent.join(spaceUrl)
console.log('Agent joined with middleware pipeline active:\n  1. Noise filter (after:stt)\n  2. Language detection (before:llm)\n  3. Safety redaction (after:llm)\n  4. Analytics logging (after:tts)\n')

agent.on('transcription', ({ speaker, text }) => console.log(`${speaker}: ${text}`))
agent.on('response', ({ text }) => console.log(`Agent: ${text}`))

process.on('SIGINT', async () => {
  console.log(`\nTotal responses: ${responseCount}`)
  await agent.destroy()
  process.exit(0)
})


