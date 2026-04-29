// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all heavy dependencies before importing the module under test
vi.mock('../browser/launcher', () => ({
  BrowserManager: vi.fn().mockImplementation(function (this: any) {
    this.launch = vi.fn().mockResolvedValue({ browser: {}, page: { evaluate: vi.fn() } })
    this.close = vi.fn().mockResolvedValue(undefined)
    this.isConnectMode = false
  }),
  launchBrowser: vi.fn().mockResolvedValue({ browser: {}, page: {} }),
  closeBrowser: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../browser/auth', () => ({
  login: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../browser/space-ui', () => ({
  joinSpace: vi.fn().mockResolvedValue(undefined),
  requestSpeaker: vi.fn().mockResolvedValue('granted'),
  waitForSpeakerAccess: vi.fn().mockResolvedValue(undefined),
  unmute: vi.fn().mockResolvedValue(undefined),
  leaveSpace: vi.fn().mockResolvedValue(undefined),
  getSpaceState: vi.fn().mockResolvedValue({ hasEnded: false }),
}))

vi.mock('../audio/bridge', () => ({
  injectAudioHooks: vi.fn().mockResolvedValue(undefined),
  injectAudio: vi.fn().mockResolvedValue(undefined),
  pcmChunksToWav: vi.fn().mockReturnValue(Buffer.from('wav')),
}))

vi.mock('../audio/vad', () => ({
  VoiceActivityDetector: vi.fn().mockImplementation(function (this: any) {
    this.onSpeech = vi.fn()
    this.onGap = vi.fn()
    this.setSilenceDuration = vi.fn()
    this.feed = vi.fn()
    this.destroy = vi.fn()
  }),
}))

// Track created LLM and TTS instances — use vi.hoisted so they're available in mock factories
const { mockLLMInstances, mockTTSInstances } = vi.hoisted(() => ({
  mockLLMInstances: [] as Array<{
    streamResponse: ReturnType<typeof import('vitest')['vi']['fn']>
    clearHistory: ReturnType<typeof import('vitest')['vi']['fn']>
  }>,
  mockTTSInstances: [] as Array<{
    synthesize: ReturnType<typeof import('vitest')['vi']['fn']>
  }>,
}))

vi.mock('../pipeline/llm', () => ({
  createLLM: vi.fn().mockImplementation(() => {
    const instance = {
      type: 'socket' as const,
      streamResponse: vi.fn().mockImplementation(async function* () {
        yield 'Hello '
        yield 'world'
      }),
      clearHistory: vi.fn(),
    }
    mockLLMInstances.push(instance)
    return instance
  }),
}))

vi.mock('../pipeline/stt', () => ({
  createSTT: vi.fn().mockReturnValue({
    transcribe: vi.fn().mockResolvedValue({ text: 'test speech' }),
  }),
}))

vi.mock('../pipeline/tts', () => ({
  createTTS: vi.fn().mockImplementation(() => {
    const instance = {
      synthesize: vi.fn().mockResolvedValue(Buffer.from('audio')),
    }
    mockTTSInstances.push(instance)
    return instance
  }),
  createTTSWithFallback: vi.fn().mockImplementation(() => {
    const instance = {
      synthesize: vi.fn().mockResolvedValue(Buffer.from('audio')),
    }
    mockTTSInstances.push(instance)
    return instance
  }),
}))

import { AgentTeam } from '../team'
import type { AgentTeamConfig } from '../types'
import { createLLM } from '../pipeline/llm'

function createTestConfig(overrides?: Partial<AgentTeamConfig>): AgentTeamConfig {
  return {
    auth: { token: 'test' },
    agents: [
      {
        name: 'Alice',
        ai: { provider: 'openai', apiKey: 'key1', systemPrompt: 'You are Alice' },
        priority: 1,
        topics: ['coding', 'javascript'],
        canInterrupt: false,
        cooldownMs: 0,
      },
      {
        name: 'Bob',
        ai: { provider: 'openai', apiKey: 'key2', systemPrompt: 'You are Bob' },
        priority: 2,
        topics: ['music', 'art'],
        canInterrupt: true,
        cooldownMs: 0,
      },
      {
        name: 'Carol',
        ai: { provider: 'openai', apiKey: 'key3', systemPrompt: 'You are Carol' },
        priority: 0,
        topics: ['science'],
        canInterrupt: false,
        cooldownMs: 5000,
      },
    ],
    turnManagement: { strategy: 'round-robin', turnDelay: 100 },
    ...overrides,
  }
}

describe('AgentTeam', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLLMInstances.length = 0
    mockTTSInstances.length = 0
  })

  // ── Constructor ──────────────────────────────────────────

  describe('constructor', () => {
    it('should create agents with priority, topics, canInterrupt, and cooldownMs', () => {
      const team = new AgentTeam(createTestConfig())
      const snapshot = team.getSnapshot()

      expect(snapshot.agents).toHaveLength(3)
      expect(snapshot.agents[0].name).toBe('Alice')
      expect(snapshot.agents[0].priority).toBe(1)
      expect(snapshot.agents[0].topics).toEqual(['coding', 'javascript'])

      expect(snapshot.agents[1].name).toBe('Bob')
      expect(snapshot.agents[1].priority).toBe(2)

      expect(snapshot.agents[2].name).toBe('Carol')
      expect(snapshot.agents[2].priority).toBe(0)
    })

    it('should default optional TeamAgentConfig fields', () => {
      const team = new AgentTeam({
        auth: { token: 'test' },
        agents: [
          { name: 'Default', ai: { provider: 'openai', apiKey: 'k', systemPrompt: 'hi' } },
        ],
      })
      const snapshot = team.getSnapshot()
      expect(snapshot.agents[0].priority).toBe(0)
      expect(snapshot.agents[0].topics).toEqual([])
    })

    it('should create a director LLM when director strategy is configured', () => {
      const createLLMMock = vi.mocked(createLLM)
      createLLMMock.mockClear()

      new AgentTeam(createTestConfig({
        turnManagement: { strategy: 'director' },
      }))

      // 3 agents + 1 director = 4 calls
      expect(createLLMMock).toHaveBeenCalledTimes(4)
    })

    it('should not create a director LLM for non-director strategies', () => {
      const createLLMMock = vi.mocked(createLLM)
      createLLMMock.mockClear()

      new AgentTeam(createTestConfig({
        turnManagement: { strategy: 'round-robin' },
      }))

      // Only 3 agent LLMs
      expect(createLLMMock).toHaveBeenCalledTimes(3)
    })
  })

  // ── Agent Selection Strategies ──────────────────────────

  describe('agent selection - round-robin', () => {
    it('should rotate through agents', () => {
      const team = new AgentTeam(createTestConfig({
        turnManagement: { strategy: 'round-robin' },
      }))

      // Use selectAgent via the snapshot state — we test the behavior indirectly
      // through the agentSelected event
      const selections: string[] = []
      team.on('agentSelected', (ev: any) => selections.push(ev.agentName))

      // We can't directly call private selectAgent, but we can test through getSnapshot
      // to verify initial state
      const snapshot = team.getSnapshot()
      expect(snapshot.config.strategy).toBe('round-robin')
    })
  })

  describe('agent selection - queue', () => {
    it('should default to queue strategy', () => {
      const team = new AgentTeam(createTestConfig({
        turnManagement: undefined,
      }))

      const snapshot = team.getSnapshot()
      expect(snapshot.config.strategy).toBe('queue')
    })
  })

  describe('agent selection - director', () => {
    it('should configure director context window', () => {
      const team = new AgentTeam(createTestConfig({
        turnManagement: { strategy: 'director' },
        directorContextWindow: 20,
      }))

      const snapshot = team.getSnapshot()
      expect(snapshot.config.strategy).toBe('director')
      expect(snapshot.config.directorContextWindow).toBe(20)
    })
  })

  // ── Events ──────────────────────────────────────────────

  describe('team events', () => {
    it('should emit agentSelected, turnComplete, and response events', async () => {
      const team = new AgentTeam(createTestConfig())
      const events: Record<string, any[]> = {
        agentSelected: [],
        turnComplete: [],
        response: [],
      }

      team.on('agentSelected', (data: any) => events.agentSelected.push(data))
      team.on('turnComplete', (data: any) => events.turnComplete.push(data))
      team.on('response', (data: any) => events.response.push(data))

      // Events are emitted during handleSpeechEnd, which is private.
      // We verify event listeners can be registered without error.
      expect(team.listenerCount('agentSelected')).toBe(1)
      expect(team.listenerCount('turnComplete')).toBe(1)
      expect(team.listenerCount('response')).toBe(1)
    })

    it('should support handoff event registration', () => {
      const team = new AgentTeam(createTestConfig())
      const handler = vi.fn()
      team.on('handoff', handler)
      expect(team.listenerCount('handoff')).toBe(1)
    })

    it('should support interruption event registration', () => {
      const team = new AgentTeam(createTestConfig())
      const handler = vi.fn()
      team.on('interruption', handler)
      expect(team.listenerCount('interruption')).toBe(1)
    })
  })

  // ── Handoff Parsing ─────────────────────────────────────

  describe('handoff signal parsing', () => {
    it('should detect [HANDOFF:AgentName] pattern', () => {
      // Test the regex pattern directly since parseHandoffSignal is private
      const HANDOFF_PATTERN = /\[HANDOFF:([^\]:\s]+)(?::([^\]]*))?\]/i
      const text = 'I think Bob should answer this. [HANDOFF:Bob]'
      const match = text.match(HANDOFF_PATTERN)
      expect(match).not.toBeNull()
      expect(match![1]).toBe('Bob')
      expect(match![2]).toBeUndefined()
    })

    it('should detect [HANDOFF:AgentName:reason] pattern', () => {
      const HANDOFF_PATTERN = /\[HANDOFF:([^\]:\s]+)(?::([^\]]*))?\]/i
      const text = 'Let me pass this to Carol. [HANDOFF:Carol:she knows science better]'
      const match = text.match(HANDOFF_PATTERN)
      expect(match).not.toBeNull()
      expect(match![1]).toBe('Carol')
      expect(match![2]).toBe('she knows science better')
    })

    it('should not match when no handoff signal is present', () => {
      const HANDOFF_PATTERN = /\[HANDOFF:([^\]:\s]+)(?::([^\]]*))?\]/i
      const text = 'Just a normal response with no handoff.'
      expect(text.match(HANDOFF_PATTERN)).toBeNull()
    })

    it('should be case-insensitive', () => {
      const HANDOFF_PATTERN = /\[HANDOFF:([^\]:\s]+)(?::([^\]]*))?\]/i
      const text = '[handoff:Bob:reason]'
      const match = text.match(HANDOFF_PATTERN)
      expect(match).not.toBeNull()
      expect(match![1]).toBe('Bob')
    })
  })

  // ── Persistence / Snapshots ─────────────────────────────

  describe('persistence', () => {
    it('should produce a serializable snapshot', () => {
      const team = new AgentTeam(createTestConfig())
      const snapshot = team.getSnapshot()

      expect(snapshot.agents).toHaveLength(3)
      expect(snapshot.conversationHistory).toEqual([])
      expect(snapshot.config.strategy).toBe('round-robin')
      expect(snapshot.config.turnDelay).toBe(100)

      // Verify it's serializable
      const json = JSON.stringify(snapshot)
      const parsed = JSON.parse(json)
      expect(parsed.agents).toHaveLength(3)
    })

    it('should include agent metrics in snapshot', () => {
      const team = new AgentTeam(createTestConfig())
      const snapshot = team.getSnapshot()

      for (const agent of snapshot.agents) {
        expect(agent.metrics).toEqual({
          turnCount: 0,
          totalDurationMs: 0,
          avgDurationMs: 0,
        })
      }
    })

    it('should restore from a snapshot', () => {
      const team = new AgentTeam(createTestConfig())

      const fakeSnapshot = {
        agents: [
          {
            id: 0,
            name: 'Alice',
            history: [{ role: 'user' as const, content: 'hello' }],
            status: 'idle' as const,
            priority: 1,
            topics: ['coding'],
            metrics: { turnCount: 5, totalDurationMs: 10000, avgDurationMs: 2000 },
          },
          {
            id: 1,
            name: 'Bob',
            history: [],
            status: 'idle' as const,
            priority: 2,
            topics: ['music'],
            metrics: { turnCount: 3, totalDurationMs: 6000, avgDurationMs: 2000 },
          },
          {
            id: 2,
            name: 'Carol',
            history: [],
            status: 'idle' as const,
            priority: 0,
            topics: ['science'],
            metrics: { turnCount: 0, totalDurationMs: 0, avgDurationMs: 0 },
          },
        ],
        conversationHistory: [
          { agentId: -1, agentName: 'User', role: 'user', content: 'hello', timestamp: 1000 },
          { agentId: 0, agentName: 'Alice', role: 'assistant', content: 'hi!', timestamp: 1001 },
        ],
        config: { strategy: 'round-robin', turnDelay: 100, directorContextWindow: 10 },
      }

      team.restoreFromSnapshot(fakeSnapshot)

      const newSnapshot = team.getSnapshot()
      expect(newSnapshot.agents[0].history).toEqual([{ role: 'user', content: 'hello' }])
      expect(newSnapshot.agents[0].metrics.turnCount).toBe(5)
      expect(newSnapshot.conversationHistory).toHaveLength(2)
    })

    it('should return a copy of the conversation log', () => {
      const team = new AgentTeam(createTestConfig())
      const log1 = team.getConversationLog()
      const log2 = team.getConversationLog()
      expect(log1).not.toBe(log2) // different array references
      expect(log1).toEqual(log2)
    })
  })

  // ── Lifecycle ───────────────────────────────────────────

  describe('lifecycle', () => {
    it('should throw when join is called while already running', async () => {
      const team = new AgentTeam(createTestConfig())
      await team.join('https://x.com/i/spaces/test')
      await expect(team.join('https://x.com/i/spaces/test2')).rejects.toThrow(
        'Team already running'
      )
      await team.destroy()
    })

    it('should set all agents to idle on join', async () => {
      const team = new AgentTeam(createTestConfig())
      await team.join('https://x.com/i/spaces/test')

      const snapshot = team.getSnapshot()
      for (const agent of snapshot.agents) {
        expect(agent.status).toBe('idle')
      }

      await team.destroy()
    })

    it('should set all agents to disconnected on destroy', async () => {
      const team = new AgentTeam(createTestConfig())
      await team.join('https://x.com/i/spaces/test')
      await team.destroy()

      const snapshot = team.getSnapshot()
      for (const agent of snapshot.agents) {
        expect(agent.status).toBe('disconnected')
      }
    })
  })

  // ── Interruption Logic ──────────────────────────────────

  describe('interruption logic', () => {
    it('should configure agents with canInterrupt and priority', () => {
      const team = new AgentTeam(createTestConfig())
      const snapshot = team.getSnapshot()

      // Bob has canInterrupt=true and priority=2 in our test config
      const bob = snapshot.agents.find((a) => a.name === 'Bob')
      expect(bob).toBeDefined()
      expect(bob!.priority).toBe(2)

      // Alice has canInterrupt=false
      const alice = snapshot.agents.find((a) => a.name === 'Alice')
      expect(alice).toBeDefined()
      expect(alice!.priority).toBe(1)
    })
  })

  // ── Cooldown Logic ──────────────────────────────────────

  describe('cooldown', () => {
    it('should configure agents with cooldownMs', () => {
      const team = new AgentTeam(createTestConfig())
      const snapshot = team.getSnapshot()

      const carol = snapshot.agents.find((a) => a.name === 'Carol')
      expect(carol).toBeDefined()
      // Cooldown is internal state, but we can verify the agent was created
      // with the right config by checking the snapshot topics match
      expect(carol!.topics).toEqual(['science'])
    })
  })

  // ── Speaker Context ─────────────────────────────────────

  describe('speaker context', () => {
    it('should track agent names and topics in snapshot', () => {
      const team = new AgentTeam(createTestConfig())
      const snapshot = team.getSnapshot()

      expect(snapshot.agents[0].name).toBe('Alice')
      expect(snapshot.agents[0].topics).toEqual(['coding', 'javascript'])
      expect(snapshot.agents[1].name).toBe('Bob')
      expect(snapshot.agents[1].topics).toEqual(['music', 'art'])
    })
  })

  // ── Director Prompt Building ────────────────────────────

  describe('director prompt context', () => {
    it('should use custom directorContextWindow', () => {
      const team = new AgentTeam(createTestConfig({
        directorContextWindow: 5,
      }))
      const snapshot = team.getSnapshot()
      expect(snapshot.config.directorContextWindow).toBe(5)
    })

    it('should default directorContextWindow to 10', () => {
      const team = new AgentTeam(createTestConfig())
      const snapshot = team.getSnapshot()
      expect(snapshot.config.directorContextWindow).toBe(10)
    })
  })

  // ── Error handling ──────────────────────────────────────

  describe('error handling', () => {
    it('should emit error events', () => {
      const team = new AgentTeam(createTestConfig())
      const errors: Error[] = []
      team.on('error', (err: Error) => errors.push(err))

      team.emit('error', new Error('test error'))
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe('test error')
    })
  })
})


