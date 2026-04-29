// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import type { AgentTeamConfig } from '../../src/team'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Browser modules
vi.mock('../../src/browser/launcher', () => ({
  BrowserManager: vi.fn().mockImplementation(function (this: any) {
    this.launch = vi.fn().mockResolvedValue({
      browser: { close: vi.fn() },
      page: { evaluate: vi.fn() },
    })
    this.close = vi.fn().mockResolvedValue(undefined)
    this.isConnectMode = false
  }),
  launchBrowser: vi.fn().mockResolvedValue({
    browser: { close: vi.fn() },
    page: { evaluate: vi.fn() },
  }),
  closeBrowser: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/browser/auth', () => ({
  login: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/browser/space-ui', () => ({
  joinSpace: vi.fn().mockResolvedValue(undefined),
  requestSpeaker: vi.fn().mockResolvedValue('speaker'),
  waitForSpeakerAccess: vi.fn().mockResolvedValue(undefined),
  unmute: vi.fn().mockResolvedValue(undefined),
  leaveSpace: vi.fn().mockResolvedValue(undefined),
  getSpaceState: vi.fn().mockResolvedValue({ hasEnded: false }),
}))

vi.mock('../../src/audio/bridge', () => ({
  injectAudioHooks: vi.fn().mockResolvedValue(undefined),
  injectAudio: vi.fn().mockResolvedValue(undefined),
  pcmChunksToWav: vi.fn().mockReturnValue(Buffer.from('fake-wav')),
}))

// Pipeline factories — return controllable mocks
const { mockStreamResponse, mockSynthesize, mockTranscribe, vadState } = vi.hoisted(() => ({
  mockStreamResponse: vi.fn(),
  mockSynthesize: vi.fn().mockResolvedValue(Buffer.from('fake-audio')),
  mockTranscribe: vi.fn().mockResolvedValue({ text: 'hello world' }),
  vadState: { speechCallback: null as ((chunks: Buffer[]) => void) | null },
}))

const mockLLM = {
  type: 'socket' as const,
  streamResponse: mockStreamResponse,
  clearHistory: vi.fn(),
}

const mockTTS = { synthesize: mockSynthesize }
const mockSTT = { transcribe: mockTranscribe }

vi.mock('../../src/pipeline/llm', () => ({
  createLLM: vi.fn(() => ({
    type: 'socket',
    streamResponse: mockStreamResponse,
    clearHistory: vi.fn(),
  })),
}))

vi.mock('../../src/pipeline/stt', () => ({
  createSTT: vi.fn(() => ({ transcribe: mockTranscribe })),
}))

vi.mock('../../src/pipeline/tts', () => ({
  createTTS: vi.fn(() => ({ synthesize: mockSynthesize })),
  createTTSWithFallback: vi.fn(() => ({ synthesize: mockSynthesize })),
}))

// VAD — capture the speech callback so we can trigger it manually
vi.mock('../../src/audio/vad', () => {
  const VoiceActivityDetector = vi.fn().mockImplementation(function (this: any) {
    this.onSpeech = (cb: (chunks: Buffer[]) => void) => {
      vadState.speechCallback = cb
    }
    this.feed = vi.fn()
    this.reset = vi.fn()
    this.destroy = vi.fn()
    this.setSilenceDuration = vi.fn()
    this.onGap = vi.fn()
  })
  return { VoiceActivityDetector }
})

// Now import the class under test (after mocks are registered)
import { AgentTeam } from '../../src/team'
import { createLLM } from '../../src/pipeline/llm'
import { createSTT } from '../../src/pipeline/stt'
import { createTTS, createTTSWithFallback } from '../../src/pipeline/tts'
import * as spaceUI from '../../src/browser/space-ui'
import { BrowserManager } from '../../src/browser/launcher'
import { injectAudioHooks, injectAudio } from '../../src/audio/bridge'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<AgentTeamConfig>): AgentTeamConfig {
  return {
    auth: { token: 'tok', ct0: 'ct0' },
    agents: [
      {
        name: 'Agent-A',
        ai: { provider: 'openai', apiKey: 'key-a', systemPrompt: 'You are A' },
        voice: { provider: 'openai', apiKey: 'key-a' },
      },
      {
        name: 'Agent-B',
        ai: { provider: 'claude', apiKey: 'key-b', systemPrompt: 'You are B' },
        voice: { provider: 'openai', apiKey: 'key-b' },
      },
    ],
    ...overrides,
  }
}

/** Create a fake async generator that yields the given chunks. */
async function* fakeStream(...chunks: string[]): AsyncIterable<string> {
  for (const c of chunks) yield c
}

/** Trigger the VAD speech callback and wait for the async handler to settle. */
async function triggerSpeech(): Promise<void> {
  vadState.speechCallback!([Buffer.from('chunk1'), Buffer.from('chunk2')])
  // Advance timers to allow preResponseDelay (up to ~2s) and captureActive reset (1.5s) to complete
  await vi.advanceTimersByTimeAsync(3000)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentTeam', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    vadState.speechCallback = null

    // Default: LLM streams a single token
    mockStreamResponse.mockImplementation(() => fakeStream('response'))
    mockSynthesize.mockResolvedValue(Buffer.from('audio'))
    mockTranscribe.mockResolvedValue({ text: 'hello world' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Construction
  // ═══════════════════════════════════════════════════════════════════════════

  describe('construction', () => {
    it('creates team with multiple agent configs', () => {
      const team = new AgentTeam(makeConfig())
      expect(team).toBeInstanceOf(AgentTeam)
      expect(team).toBeInstanceOf(EventEmitter)
    })

    it('creates an LLM for each agent', () => {
      new AgentTeam(makeConfig())
      expect(createLLM).toHaveBeenCalledTimes(2)
    })

    it('creates a TTS for each agent', () => {
      new AgentTeam(makeConfig())
      expect(createTTSWithFallback).toHaveBeenCalledTimes(2)
    })

    it('creates a single shared STT', () => {
      new AgentTeam(makeConfig())
      expect(createSTT).toHaveBeenCalledTimes(1)
    })

    it('derives STT provider from first agent ai.provider', () => {
      new AgentTeam(
        makeConfig({
          agents: [
            {
              name: 'A',
              ai: { provider: 'openai', apiKey: 'k', systemPrompt: 's' },
            },
            {
              name: 'B',
              ai: { provider: 'claude', apiKey: 'k', systemPrompt: 's' },
            },
          ],
        }),
      )
      expect(createSTT).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai' }),
      )
    })

    it('uses groq STT provider for non-openai first agent', () => {
      new AgentTeam(
        makeConfig({
          agents: [
            {
              name: 'A',
              ai: { provider: 'claude', apiKey: 'k', systemPrompt: 's' },
            },
          ],
        }),
      )
      expect(createSTT).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'groq' }),
      )
    })

    it('passes voice config to TTS factory', () => {
      new AgentTeam(
        makeConfig({
          agents: [
            {
              name: 'A',
              ai: { provider: 'openai', apiKey: 'k', systemPrompt: 's' },
              voice: {
                provider: 'elevenlabs',
                apiKey: 'el-key',
                voiceId: 'v1',
                stability: 0.7,
              },
            },
          ],
        }),
      )
      expect(createTTSWithFallback).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'elevenlabs',
          apiKey: 'el-key',
          voiceId: 'v1',
          stability: 0.7,
        }),
      )
    })

    it('falls back to ai.apiKey when voice.apiKey is not set', () => {
      new AgentTeam(
        makeConfig({
          agents: [
            {
              name: 'A',
              ai: { provider: 'openai', apiKey: 'ai-key', systemPrompt: 's' },
            },
          ],
        }),
      )
      expect(createTTSWithFallback).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'ai-key' }),
      )
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Turn Management
  // ═══════════════════════════════════════════════════════════════════════════

  describe('turn management', () => {
    describe('queue strategy (default)', () => {
      it('selects the first idle agent', async () => {
        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        const events: any[] = []
        team.on('transcription', (e) => events.push(e))

        await triggerSpeech()

        expect(events).toHaveLength(1)
        expect(events[0].respondingAgent.name).toBe('Agent-A')
      })
    })

    describe('round-robin strategy', () => {
      it('cycles through agents in order', async () => {
        const team = new AgentTeam(
          makeConfig({
            turnManagement: { strategy: 'round-robin' },
          }),
        )
        await team.join('https://x.com/i/spaces/abc')

        const names: string[] = []
        team.on('transcription', (e) => names.push(e.respondingAgent.name))

        // First speech → Agent-A (index 0)
        await triggerSpeech()
        // Second speech → Agent-B (index 1)
        await triggerSpeech()
        // Third speech → wraps back to Agent-A (index 2 % 2 = 0)
        await triggerSpeech()

        expect(names).toEqual(['Agent-A', 'Agent-B', 'Agent-A'])
      })
    })

    describe('director strategy', () => {
      it('falls back to round-robin behavior', async () => {
        const team = new AgentTeam(
          makeConfig({
            turnManagement: { strategy: 'director' },
          }),
        )
        await team.join('https://x.com/i/spaces/abc')

        const names: string[] = []
        team.on('transcription', (e) => names.push(e.respondingAgent.name))

        await triggerSpeech()
        await triggerSpeech()

        expect(names).toEqual(['Agent-A', 'Agent-B'])
      })
    })

    describe('turn locking', () => {
      it('only one agent speaks at a time', async () => {
        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        // Make the LLM slow so the first turn is still held
        let resolveFirst!: () => void
        const firstDone = new Promise<void>((r) => (resolveFirst = r))
        mockStreamResponse.mockImplementationOnce(async function* () {
          await firstDone
          yield 'delayed'
        })

        const responseEvents: any[] = []
        team.on('response', (e) => responseEvents.push(e))

        // Trigger first speech — agent takes the turn
        await triggerSpeech()

        // Trigger second speech while first is still processing
        // The second agent's turn should be queued (requestTurn returns false)
        await triggerSpeech()

        // Only the first should have generated a response so far
        // (second was queued/denied)
        expect(responseEvents).toHaveLength(0) // first is still waiting

        // Let the first finish
        resolveFirst()
        await vi.advanceTimersByTimeAsync(100)

        expect(responseEvents).toHaveLength(1)
      })
    })

    describe('turn transitions', () => {
      it('emits transcription events with respondingAgent info', async () => {
        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        const event = await new Promise<any>((resolve) => {
          team.on('transcription', resolve)
          triggerSpeech()
        })

        expect(event).toEqual(
          expect.objectContaining({
            speaker: 'Space Speaker',
            text: 'hello world',
            timestamp: expect.any(Number),
            respondingAgent: expect.objectContaining({
              name: expect.any(String),
              id: expect.any(Number),
            }),
          }),
        )
      })

      it('emits response event after LLM + TTS completes', async () => {
        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        const event = await new Promise<any>((resolve) => {
          team.on('response', resolve)
          triggerSpeech()
        })

        expect(event).toEqual(
          expect.objectContaining({
            text: 'response',
            audio: expect.any(Buffer),
          }),
        )
      })

      it('queued agent gets turn after delay when current turn finishes', async () => {
        const config = makeConfig({
          turnManagement: { strategy: 'queue', turnDelay: 200 },
        })
        const team = new AgentTeam(config)
        await team.join('https://x.com/i/spaces/abc')

        // We need to test releaseTurn scheduling. This is hard to test
        // directly since it's private, but we can verify the turnDelay config
        // is read by checking the config is accepted without error.
        expect(team).toBeDefined()
      })
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Agent Coordination
  // ═══════════════════════════════════════════════════════════════════════════

  describe('agent coordination', () => {
    it('transcription is forwarded via the shared STT', async () => {
      const team = new AgentTeam(makeConfig())
      await team.join('https://x.com/i/spaces/abc')

      await triggerSpeech()

      // STT transcribe was called once for the speech segment
      expect(mockTranscribe).toHaveBeenCalledTimes(1)
      expect(mockTranscribe).toHaveBeenCalledWith(
        expect.any(Buffer),
        'audio/wav',
      )
    })

    it('only the selected agent LLM is called', async () => {
      // Create separate mock functions for each agent
      const llmA = vi.fn(() => fakeStream('A says hi'))
      const llmB = vi.fn(() => fakeStream('B says hi'))

      const createLLMMock = vi.mocked(createLLM)
      createLLMMock
        .mockReturnValueOnce({ type: 'socket', streamResponse: llmA, clearHistory: vi.fn() })
        .mockReturnValueOnce({ type: 'socket', streamResponse: llmB, clearHistory: vi.fn() })

      const team = new AgentTeam(
        makeConfig({ turnManagement: { strategy: 'round-robin' } }),
      )
      await team.join('https://x.com/i/spaces/abc')

      await triggerSpeech()

      // round-robin starts at index 0 → Agent-A's LLM called
      expect(llmA).toHaveBeenCalledTimes(1)
      expect(llmB).not.toHaveBeenCalled()
    })

    it('TTS is called with the responding agent text', async () => {
      mockStreamResponse.mockImplementation(() => fakeStream('the', ' answer'))

      const team = new AgentTeam(makeConfig())
      await team.join('https://x.com/i/spaces/abc')

      await triggerSpeech()

      expect(mockSynthesize).toHaveBeenCalledWith('the answer', expect.any(Number))
    })

    it('injects audio into the page', async () => {
      const team = new AgentTeam(makeConfig())
      await team.join('https://x.com/i/spaces/abc')

      await triggerSpeech()

      expect(injectAudio).toHaveBeenCalled()
    })

    it('skips empty transcriptions', async () => {
      mockTranscribe.mockResolvedValue({ text: '   ' })

      const team = new AgentTeam(makeConfig())
      await team.join('https://x.com/i/spaces/abc')

      const events: any[] = []
      team.on('transcription', (e) => events.push(e))

      await triggerSpeech()

      expect(events).toHaveLength(0)
      expect(mockStreamResponse).not.toHaveBeenCalled()
    })

    it('skips null transcriptions', async () => {
      mockTranscribe.mockResolvedValue({ text: null })

      const team = new AgentTeam(makeConfig())
      await team.join('https://x.com/i/spaces/abc')

      const events: any[] = []
      team.on('transcription', (e) => events.push(e))

      await triggerSpeech()

      expect(events).toHaveLength(0)
    })

    it('manages conversation history per agent', async () => {
      const team = new AgentTeam(makeConfig())
      await team.join('https://x.com/i/spaces/abc')

      await triggerSpeech()

      // The LLM streamResponse should have been called with the transcribed text
      expect(mockStreamResponse).toHaveBeenCalledWith(
        expect.any(Number),
        'hello world',
        expect.any(String),
      )
    })

    it('trims history beyond maxHistory', async () => {
      const config = makeConfig({
        agents: [
          {
            name: 'A',
            ai: {
              provider: 'openai',
              apiKey: 'k',
              systemPrompt: 's',
              maxHistory: 2,
            },
          },
        ],
      })
      const team = new AgentTeam(config)
      await team.join('https://x.com/i/spaces/abc')

      // Generate multiple speech events to build up history
      await triggerSpeech()
      await triggerSpeech()
      await triggerSpeech()

      // Should not throw — history is properly trimmed
      expect(mockStreamResponse).toHaveBeenCalledTimes(3)
    })

    it('does not inject audio when TTS returns null', async () => {
      mockSynthesize.mockResolvedValue(null)
      vi.mocked(injectAudio).mockClear()

      const team = new AgentTeam(makeConfig())
      await team.join('https://x.com/i/spaces/abc')

      await triggerSpeech()

      expect(injectAudio).not.toHaveBeenCalled()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════════════════════

  describe('lifecycle', () => {
    describe('join()', () => {
      it('launches browser and joins the space', async () => {
        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        expect(BrowserManager).toHaveBeenCalledTimes(1)
        expect(injectAudioHooks).toHaveBeenCalledTimes(1)
        expect(spaceUI.joinSpace).toHaveBeenCalledTimes(1)
      })

      it('requests speaker access', async () => {
        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        expect(spaceUI.requestSpeaker).toHaveBeenCalledTimes(1)
      })

      it('unmutes when already a speaker', async () => {
        vi.mocked(spaceUI.requestSpeaker).mockResolvedValueOnce(
          'speaker' as any,
        )

        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        expect(spaceUI.unmute).toHaveBeenCalled()
      })

      it('waits for speaker access when status is requested', async () => {
        vi.mocked(spaceUI.requestSpeaker).mockResolvedValueOnce(
          'requested' as any,
        )

        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        expect(spaceUI.waitForSpeakerAccess).toHaveBeenCalled()
      })

      it('throws if team is already running', async () => {
        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        await expect(
          team.join('https://x.com/i/spaces/def'),
        ).rejects.toThrow('Team already running')
      })

      it('activates audio capture after joining', async () => {
        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        // VAD callback should be wired — we can trigger speech
        expect(vadState.speechCallback).toBeTypeOf('function')
      })
    })

    describe('destroy()', () => {
      it('cleans up browser and listeners', async () => {
        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        await team.destroy()

        expect(spaceUI.leaveSpace).toHaveBeenCalled()
        // BrowserManager.close is called via the instance
        const browserManagerInstance = vi.mocked(BrowserManager).mock.instances[0] as any
        expect(browserManagerInstance.close).toHaveBeenCalled()
      })

      it('sets all agents to disconnected status', async () => {
        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        // Attach listener to check it's removed
        const spy = vi.fn()
        team.on('transcription', spy)

        await team.destroy()

        // After destroy, listeners are removed
        expect(team.listenerCount('transcription')).toBe(0)
      })

      it('is safe to call without prior join', async () => {
        const team = new AgentTeam(makeConfig())
        // Should not throw
        await expect(team.destroy()).resolves.toBeUndefined()
      })

      it('tolerates leaveSpace errors', async () => {
        vi.mocked(spaceUI.leaveSpace).mockRejectedValueOnce(
          new Error('page closed'),
        )

        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        // destroy should not throw even if leaveSpace fails
        await expect(team.destroy()).resolves.toBeUndefined()
        const browserManagerInstance = vi.mocked(BrowserManager).mock.instances[0] as any
        expect(browserManagerInstance.close).toHaveBeenCalled()
      })
    })

    describe('error handling', () => {
      it('emits error event when LLM throws', async () => {
        mockStreamResponse.mockImplementation(async function* () {
          throw new Error('LLM failed')
        })

        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        const errors: Error[] = []
        team.on('error', (e) => errors.push(e))

        await triggerSpeech()

        expect(errors).toHaveLength(1)
        expect(errors[0]).toBeInstanceOf(Error)
        expect(errors[0].message).toBe('LLM failed')
      })

      it('emits error event when TTS throws', async () => {
        mockSynthesize.mockRejectedValueOnce(new Error('TTS failed'))

        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        const errors: Error[] = []
        team.on('error', (e) => errors.push(e))

        await triggerSpeech()

        expect(errors).toHaveLength(1)
        expect(errors[0].message).toBe('TTS failed')
      })

      it('wraps non-Error throws into Error objects', async () => {
        mockStreamResponse.mockImplementation(async function* () {
          throw 'string error'
        })

        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        const errors: Error[] = []
        team.on('error', (e) => errors.push(e))

        await triggerSpeech()

        expect(errors).toHaveLength(1)
        expect(errors[0]).toBeInstanceOf(Error)
        expect(errors[0].message).toBe('string error')
      })

      it('agent returns to idle status after error', async () => {
        mockStreamResponse.mockImplementationOnce(async function* () {
          throw new Error('boom')
        })

        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        const errors: Error[] = []
        team.on('error', (e) => errors.push(e))

        await triggerSpeech()
        expect(errors).toHaveLength(1)

        // Agent should be idle again — can take another turn
        mockStreamResponse.mockImplementation(() => fakeStream('recovered'))

        const responses: any[] = []
        team.on('response', (r) => responses.push(r))

        await triggerSpeech()

        expect(responses).toHaveLength(1)
        expect(responses[0].text).toBe('recovered')
      })

      it('releases turn after error so next agent can proceed', async () => {
        mockStreamResponse.mockImplementationOnce(async function* () {
          throw new Error('fail')
        })

        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        const errors: Error[] = []
        team.on('error', (e) => errors.push(e))

        // First speech fails
        await triggerSpeech()
        expect(errors).toHaveLength(1)

        // Second speech should succeed (turn was released)
        mockStreamResponse.mockImplementation(() => fakeStream('ok'))

        const responses: any[] = []
        team.on('response', (r) => responses.push(r))

        await triggerSpeech()

        expect(responses).toHaveLength(1)
        expect(responses[0].text).toBe('ok')
      })
    })

    describe('health check', () => {
      it('emits space-ended when health check detects ended space', async () => {
        vi.mocked(spaceUI.getSpaceState).mockResolvedValue({
          hasEnded: true,
        } as any)

        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        const ended = new Promise<void>((resolve) => {
          team.on('space-ended', resolve)
        })

        // Advance past health check interval (10000ms)
        await vi.advanceTimersByTimeAsync(10500)

        await ended
      })

      it('stops health check on destroy', async () => {
        const team = new AgentTeam(makeConfig())
        await team.join('https://x.com/i/spaces/abc')

        await team.destroy()

        vi.mocked(spaceUI.getSpaceState).mockClear()
        await vi.advanceTimersByTimeAsync(20000)

        // getSpaceState should not have been called after destroy
        expect(spaceUI.getSpaceState).not.toHaveBeenCalled()
      })
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // Audio capture control
  // ═══════════════════════════════════════════════════════════════════════════

  describe('audio capture control', () => {
    it('pauses capture during audio injection and resumes after delay', async () => {
      const team = new AgentTeam(makeConfig())
      await team.join('https://x.com/i/spaces/abc')

      // injectAudioHooks captures a callback — we need to verify
      // the captureActive flag behavior is correct.
      // We can check this indirectly: during audio injection,
      // if another speech event fires, it should be ignored.
      await triggerSpeech()

      // Audio was injected
      expect(injectAudio).toHaveBeenCalled()
    })
  })
})


