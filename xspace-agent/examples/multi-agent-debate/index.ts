// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§67]

/**
 * Multi-agent debate: two AI agents with opposing viewpoints debate in a Space.
 *
 * Usage:
 *   X_AUTH_TOKEN=... OPENAI_API_KEY=... ANTHROPIC_API_KEY=... \
 *     npx tsx index.ts https://x.com/i/spaces/abc123 "Should AI be regulated?"
 */
import { AgentTeam } from 'xspace-agent'

const spaceUrl = process.argv[2]
const topic = process.argv[3] || 'AI will replace most software engineering jobs within 5 years'

if (!spaceUrl) {
  console.error('Usage: npx tsx index.ts <space-url> [debate-topic]')
  process.exit(1)
}

const team = new AgentTeam({
  auth: { token: process.env.X_AUTH_TOKEN! },
  agents: [
    {
      name: 'Sunny',
      ai: {
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: process.env.OPENAI_API_KEY!,
        systemPrompt:
          `You are "Sunny", an optimistic tech futurist. You see positive potential in everything.\n` +
          `The debate topic is: "${topic}"\n` +
          `Challenge pessimism with data and enthusiasm. Keep responses to 1-2 sentences.`,
      },
      voice: { provider: 'openai', voiceId: 'nova' },
      topics: ['technology', 'future', 'AI', 'opportunity'],
      priority: 1,
    },
    {
      name: 'Rex',
      ai: {
        provider: 'claude',
        model: 'claude-sonnet-4-20250514',
        apiKey: process.env.ANTHROPIC_API_KEY!,
        systemPrompt:
          `You are "Rex", a thoughtful skeptic. You question assumptions and demand evidence.\n` +
          `The debate topic is: "${topic}"\n` +
          `Point out flaws, risks, and overlooked downsides. Keep responses to 1-2 sentences.`,
      },
      voice: { provider: 'openai', voiceId: 'onyx' },
      topics: ['ethics', 'evidence', 'risk', 'policy'],
      priority: 1,
    },
  ],
  turnManagement: {
    strategy: 'round-robin',
    turnDelay: 2000,
  },
})

console.log(`Debate topic: "${topic}"\n`)

team.on('agentSelected', ({ agentName, reason }) => {
  console.log(`\n--- ${agentName}'s turn (${reason}) ---`)
})

team.on('transcription', ({ text, respondingAgent }) => {
  console.log(`[Speaker]: ${text}`)
  console.log(`  → ${respondingAgent.name} will respond`)
})

team.on('response', ({ text }) => {
  console.log(`[Agent]: ${text}`)
})

team.on('error', (err) => console.error('Error:', err.message))
team.on('space-ended', () => {
  console.log('\n--- Space ended ---')
  process.exit(0)
})

await team.join(spaceUrl)
console.log('Both agents joined. Debate starting...\n')

process.on('SIGINT', async () => {
  await team.destroy()
  console.log('Debate ended.')
  process.exit(0)
})


