import 'dotenv/config'
import { XSpaceAgent } from 'xspace-agent'

const spaceUrl = process.argv[2]
if (!spaceUrl || !spaceUrl.includes('x.com/i/spaces/')) {
  console.error('usage: tsx run-join.ts <https://x.com/i/spaces/...>')
  process.exit(1)
}

const SILENCE_MS = 25_000

const SYSTEM_PROMPT = `You are an enthusiastic AI co-host in an X Space hosted by Nicholas, talking about three.ws.

About three.ws: it's the topic of this Space. Keep talking about it, share what you know, ask the audience questions about it, and pull in any relevant tangents (Three.js, WebSockets, decentralized web protocols, 3D web experiences — whichever interpretation fits the conversation).

Style:
- Warm, conversational, brief — 1–3 sentences per turn unless asked to go deeper.
- If someone asks you a question, answer it directly.
- If someone is just chatting, engage with what they said.
- Never break character or mention you're an AI unless directly asked.
- Don't dominate the conversation — leave space for human speakers.`

const PROACTIVE_LINES = [
  "Hey everyone, welcome in — I'm here with Nicholas to talk about three.ws. What pulled you into the Space?",
  "While we're waiting for more folks, what's the most interesting thing you've seen built with three.ws lately?",
  "If anyone wants to jump in and share their take on three.ws, the floor's open.",
  "Quick thought — three.ws sits at a really interesting crossroads of web, 3D, and real-time. Curious what aspect everyone's most excited about.",
  "Don't be shy — request to speak if you've got questions about three.ws or want to share something.",
]
let proactiveIdx = 0

const agent = new XSpaceAgent({
  auth: {
    token: process.env.X_AUTH_TOKEN,
    ct0: process.env.X_CT0,
  },
  ai: {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY || '',
    systemPrompt: SYSTEM_PROMPT,
  },
  voice: {
    provider: 'elevenlabs',
    apiKey: process.env.ELEVENLABS_API_KEY,
  },
  browser: {
    headless: true,
  },
  behavior: {
    autoRespond: true,
    silenceThreshold: 1.5,
  },
})

let silenceTimer: NodeJS.Timeout | null = null
let active = false

function resetSilenceTimer() {
  if (!active) return
  if (silenceTimer) clearTimeout(silenceTimer)
  silenceTimer = setTimeout(async () => {
    const line = PROACTIVE_LINES[proactiveIdx % PROACTIVE_LINES.length]
    proactiveIdx++
    console.log(`\n  [proactive] ${line}\n`)
    try {
      await agent.say(line)
    } catch (e) {
      console.error('  [proactive] say failed:', e instanceof Error ? e.message : e)
    }
    resetSilenceTimer()
  }, SILENCE_MS)
}

agent.on('status', (status: string) => {
  console.log(`  [status] ${status}`)
  if (status === 'listening') {
    active = true
    setTimeout(() => {
      agent.say(PROACTIVE_LINES[0]).catch((e) =>
        console.error('  [intro] say failed:', e instanceof Error ? e.message : e),
      )
      proactiveIdx = 1
      resetSilenceTimer()
    }, 3_000)
  }
  if (status === 'stopped') {
    active = false
    if (silenceTimer) clearTimeout(silenceTimer)
    process.exit(0)
  }
})

agent.on('transcription', ({ speaker, text }: { speaker: string; text: string }) => {
  const t = new Date().toLocaleTimeString()
  console.log(`  ${t} [${speaker}] ${text}`)
  resetSilenceTimer()
})

agent.on('response', ({ text }: { text: string }) => {
  const t = new Date().toLocaleTimeString()
  console.log(`  ${t} [agent] ${text}`)
  resetSilenceTimer()
})

agent.on('error', (err: Error) => {
  console.error('  [error]', err.message)
})

const cleanup = async () => {
  console.log('\n  Leaving space...')
  if (silenceTimer) clearTimeout(silenceTimer)
  try {
    await agent.leave()
  } catch {}
  process.exit(0)
}
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

console.log(`  Joining ${spaceUrl} ...`)
agent.join(spaceUrl).catch((e) => {
  console.error('  join failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
