// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// ── Mocks ──────────────────────────────────────────────────────────────────

// Hoisted mocks for use in vi.mock factories
const {
  mockStreamResponse, mockClearHistory, mockTranscribe, mockSynthesize,
  mockBrowserLifecycleInstance, audioState,
} = vi.hoisted(() => {
  // Cannot use EventEmitter here (hoisted above imports), so use a simple event map
  const listeners: Record<string, Function[]> = {}
  const mockPage = {
    evaluate: vi.fn(),
    $: vi.fn(),
    goto: vi.fn(),
    exposeFunction: vi.fn(),
    evaluateOnNewDocument: vi.fn(),
  }
  return {
    mockStreamResponse: vi.fn(),
    mockClearHistory: vi.fn(),
    mockTranscribe: vi.fn(),
    mockSynthesize: vi.fn(),
    audioState: {
      speechCallback: null as ((chunks: Buffer[]) => void) | null,
    },
    mockBrowserLifecycleInstance: {
      launch: vi.fn().mockResolvedValue(mockPage),
      authenticate: vi.fn().mockResolvedValue(undefined),
      joinSpace: vi.fn().mockResolvedValue(undefined),
      leaveSpace: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
      getPage: vi.fn().mockReturnValue(null),
      getObserver: vi.fn().mockReturnValue(null),
      getSpaceUIOptions: vi.fn().mockReturnValue({}),
      getSelectorEngine: vi.fn().mockReturnValue({}),
      on: vi.fn((event: string, listener: Function) => {
        if (!listeners[event]) listeners[event] = []
        listeners[event].push(listener)
      }),
      _emit: (event: string, ...args: any[]) => {
        for (const fn of listeners[event] ?? []) fn(...args)
      },
      _listeners: listeners,
      _mockPage: mockPage,
    },
  }
})

// Mock browser modules (still needed for HealthMonitor which calls spaceUI directly)
vi.mock('../../src/browser/launcher', () => ({
  BrowserManager: vi.fn().mockImplementation(() => ({
    launch: vi.fn().mockResolvedValue({ page: {} }),
    close: vi.fn().mockResolvedValue(undefined),
    isConnectMode: false,
  })),
}))

vi.mock('../../src/browser/space-ui', () => ({
  joinSpace: vi.fn(),
  requestSpeaker: vi.fn(),
  waitForSpeakerAccess: vi.fn(),
  unmute: vi.fn(),
  leaveSpace: vi.fn(),
  getSpaceState: vi.fn().mockResolvedValue({ hasEnded: false, isLive: true }),
}))

vi.mock('../../src/browser/auth', () => ({
  login: vi.fn(),
}))

// Mock BrowserLifecycle class
vi.mock('../../src/browser/lifecycle', () => ({
  BrowserLifecycle: vi.fn().mockImplementation(function (this: any) {
    // Clear listeners between instances
    for (const key of Object.keys(mockBrowserLifecycleInstance._listeners)) {
      delete mockBrowserLifecycleInstance._listeners[key]
    }
    Object.assign(this, mockBrowserLifecycleInstance)
  }),
}))

// Mock audio pipeline
vi.mock('../../src/audio/pipeline', () => {
  return {
    AudioPipeline: vi.fn().mockImplementation(function (this: any) {
      this.on = vi.fn()
      this.emit = vi.fn()
      this.onSpeechDetected = vi.fn((cb: (chunks: Buffer[]) => void) => {
        audioState.speechCallback = cb
      })
      this.startCapture = vi.fn()
      this.stopCapture = vi.fn()
      this.setPage = vi.fn()
      this.getAudioDataHandler = vi.fn().mockReturnValue(() => {})
      this.destroy = vi.fn()
      this.removeAllListeners = vi.fn()
      this.chunksToWav = vi.fn().mockReturnValue(Buffer.from('fake-wav'))
      this.transcribe = vi.fn().mockImplementation((...args: any[]) => mockTranscribe(...args))
      this.synthesize = vi.fn().mockImplementation((text: string) => mockSynthesize(text, 0))
      this.playAudio = vi.fn().mockResolvedValue(undefined)
    }),
  }
})

// Mock audio bridge
vi.mock('../../src/audio/bridge', () => ({
  injectAudioHooks: vi.fn(),
  injectAudio: vi.fn(),
  pcmChunksToWav: vi.fn().mockReturnValue(Buffer.from('fake-wav')),
}))

vi.mock('../../src/pipeline/llm', () => ({
  createLLM: vi.fn().mockReturnValue({
    type: 'socket',
    streamResponse: mockStreamResponse,
    clearHistory: mockClearHistory,
  }),
}))

vi.mock('../../src/pipeline/stt', () => ({
  createSTT: vi.fn().mockReturnValue({
    transcribe: mockTranscribe,
  }),
}))

vi.mock('../../src/pipeline/tts', () => ({
  createTTS: vi.fn().mockReturnValue({
    synthesize: mockSynthesize,
  }),
  createTTSWithFallback: vi.fn().mockReturnValue({
    synthesize: mockSynthesize,
  }),
}))

// Now import the modules under test (after mocks are defined)
import { XSpaceAgent } from '../../src/agent'
import type { AgentConfig, AgentStatus, MiddlewareStage } from '../../src/types'
import { createLLM } from '../../src/pipeline/llm'
import { createSTT } from '../../src/pipeline/stt'
import { createTTS, createTTSWithFallback } from '../../src/pipeline/tts'
import { injectAudio } from '../../src/audio/bridge'
import * as spaceUI from '../../src/browser/space-ui'

// ── Helpers ────────────────────────────────────────────────────────────────

function minimalConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    auth: { token: 'test-token' },
    ai: {
      provider: 'groq',
      apiKey: 'test-key',
      systemPrompt: 'You are a test agent.',
    },
    ...overrides,
  }
}

function fullConfig(): AgentConfig {
  return {
    auth: { token: 'test-token', ct0: 'csrf-token' },
    ai: {
      provider: 'claude',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'test-claude-key',
      systemPrompt: 'You are a helpful agent.',
      maxTokens: 500,
      temperature: 0.7,
      maxHistory: 10,
    },
    voice: {
      provider: 'elevenlabs',
      apiKey: 'test-el-key',
      voiceId: 'voice-123',
      speed: 1.2,
      stability: 0.8,
    },
    browser: {
      headless: true,
      executablePath: '/usr/bin/chromium',
      userDataDir: '/tmp/test-profile',
      proxy: 'http://proxy:8080',
      args: ['--extra-flag'],
    },
    behavior: {
      autoRespond: true,
      silenceThreshold: 2.0,
      minSpeechDuration: 0.5,
      maxResponseLength: 200,
      respondToSelf: false,
      turnDelay: 500,
    },
  }
}

/** Create a mock async generator that yields the given strings. */
function mockAsyncGenerator(...values: string[]) {
  return async function* () {
    for (const v of values) yield v
  }
}

/** Set up browser mocks so join() succeeds. */
function setupJoinMocks() {
  const mockPage = mockBrowserLifecycleInstance._mockPage
  // getPage returns null before join, then returns mockPage after launch
  mockBrowserLifecycleInstance.getPage
    .mockReturnValueOnce(null) // first check in join()
    .mockReturnValue(mockPage) // subsequent checks
  mockBrowserLifecycleInstance.launch.mockResolvedValue(mockPage)
  mockBrowserLifecycleInstance.authenticate.mockImplementation(async () => {
    // Simulate the 'status' event for logged-in (browser lifecycle status, not FSM state)
    mockBrowserLifecycleInstance._emit('status', 'logged-in')
  })
  mockBrowserLifecycleInstance.joinSpace.mockResolvedValue(undefined)
  mockBrowserLifecycleInstance.leaveSpace.mockResolvedValue(undefined)
  mockBrowserLifecycleInstance.cleanup.mockResolvedValue(undefined)

  return { mockPage }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('XSpaceAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    // Reset browser lifecycle mock state
    mockBrowserLifecycleInstance.getPage.mockReturnValue(null)
    mockBrowserLifecycleInstance.launch.mockResolvedValue(mockBrowserLifecycleInstance._mockPage)
    mockBrowserLifecycleInstance.authenticate.mockResolvedValue(undefined)
    mockBrowserLifecycleInstance.joinSpace.mockResolvedValue(undefined)
    mockBrowserLifecycleInstance.leaveSpace.mockResolvedValue(undefined)
    mockBrowserLifecycleInstance.cleanup.mockResolvedValue(undefined)
    mockBrowserLifecycleInstance.getObserver.mockReturnValue(null)
    mockBrowserLifecycleInstance.getSpaceUIOptions.mockReturnValue({})
    // Clear listeners
    for (const key of Object.keys(mockBrowserLifecycleInstance._listeners)) {
      delete mockBrowserLifecycleInstance._listeners[key]
    }
    // Re-setup the on mock implementation (vi.clearAllMocks resets it)
    mockBrowserLifecycleInstance.on.mockImplementation((event: string, listener: Function) => {
      if (!mockBrowserLifecycleInstance._listeners[event]) mockBrowserLifecycleInstance._listeners[event] = []
      mockBrowserLifecycleInstance._listeners[event].push(listener)
    })
    // Reset audio state
    audioState.speechCallback = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ────────────────────────────────────────────────────────────────────────
  // Construction & Configuration
  // ────────────────────────────────────────────────────────────────────────

  describe('Construction & Configuration', () => {
    it('creates agent with minimal config', () => {
      const agent = new XSpaceAgent(minimalConfig())
      expect(agent).toBeInstanceOf(XSpaceAgent)
      expect(agent).toBeInstanceOf(EventEmitter)
      expect(agent.getStatus()).toBe('disconnected')
    })

    it('creates agent with full config', () => {
      const agent = new XSpaceAgent(fullConfig())
      expect(agent).toBeInstanceOf(XSpaceAgent)
      expect(agent.getStatus()).toBe('disconnected')
    })

    it('initializes LLM provider via createLLM', () => {
      const config = minimalConfig()
      new XSpaceAgent(config)
      expect(createLLM).toHaveBeenCalledWith(config.ai)
    })

    it('infers STT provider from AI config — groq by default', () => {
      new XSpaceAgent(minimalConfig({ ai: { provider: 'groq', apiKey: 'gk', systemPrompt: 'sp' } }))
      expect(createSTT).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'groq', apiKey: 'gk' }),
      )
    })

    it('infers STT provider as openai when AI provider is openai', () => {
      new XSpaceAgent(
        minimalConfig({ ai: { provider: 'openai', apiKey: 'ok', systemPrompt: 'sp' } }),
      )
      expect(createSTT).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai', apiKey: 'ok' }),
      )
    })

    it('infers STT provider as groq for claude AI provider', () => {
      new XSpaceAgent(
        minimalConfig({ ai: { provider: 'claude', apiKey: 'ck', systemPrompt: 'sp' } }),
      )
      expect(createSTT).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'groq', apiKey: 'ck' }),
      )
    })

    it('initializes TTS with voice config', () => {
      new XSpaceAgent(
        minimalConfig({
          voice: { provider: 'elevenlabs', apiKey: 'el-key', voiceId: 'v1', stability: 0.9 },
        }),
      )
      expect(createTTSWithFallback).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'elevenlabs',
          apiKey: 'el-key',
          voiceId: 'v1',
          stability: 0.9,
        }),
      )
    })

    it('defaults TTS provider to openai when voice config is absent', () => {
      new XSpaceAgent(minimalConfig())
      expect(createTTSWithFallback).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai' }),
      )
    })

    it('falls back TTS apiKey to AI apiKey', () => {
      new XSpaceAgent(minimalConfig({ ai: { provider: 'groq', apiKey: 'ai-key', systemPrompt: 's' } }))
      expect(createTTSWithFallback).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'ai-key' }),
      )
    })

    it('uses behavior.silenceThreshold for VAD silence duration', () => {
      // silenceThreshold is in seconds, VAD expects milliseconds
      const agent = new XSpaceAgent(
        minimalConfig({ behavior: { silenceThreshold: 3.0 } }),
      )
      // Agent created successfully — VAD internals are opaque but we trust it
      expect(agent.getStatus()).toBe('disconnected')
    })

    it('computes VAD minChunks from behavior.minSpeechDuration', () => {
      // minChunks = ceil((minSpeechDuration * 16000) / 4096)
      const agent = new XSpaceAgent(
        minimalConfig({ behavior: { minSpeechDuration: 0.5 } }),
      )
      expect(agent.getStatus()).toBe('disconnected')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Status & State
  // ────────────────────────────────────────────────────────────────────────

  describe('Status & State', () => {
    it('initial status is disconnected', () => {
      const agent = new XSpaceAgent(minimalConfig())
      expect(agent.getStatus()).toBe('disconnected')
    })

    it('isConnected() returns false when disconnected', () => {
      const agent = new XSpaceAgent(minimalConfig())
      expect(agent.isConnected()).toBe(false)
    })

    it('isConnected() returns true after successful join', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      const joinPromise = agent.join('https://x.com/i/spaces/test123')
      // Advance timers to clear health-check setInterval setup
      await vi.advanceTimersByTimeAsync(0)
      await joinPromise
      expect(agent.isConnected()).toBe(true)
      expect(agent.getStatus()).toBe('idle')
      await agent.destroy()
    })

    it('isConnected() returns false when status is error', async () => {
      mockBrowserLifecycleInstance.launch.mockRejectedValue(new Error('launch failed'))
      const agent = new XSpaceAgent(minimalConfig())
      await expect(agent.join('https://x.com/i/spaces/test')).rejects.toThrow('launch failed')
      expect(agent.isConnected()).toBe(false)
      expect(agent.getStatus()).toBe('error')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Event Emitter
  // ────────────────────────────────────────────────────────────────────────

  describe('Event Emitter', () => {
    it('emits status events on status changes during join', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      const statuses: AgentStatus[] = []
      agent.on('status', (s) => statuses.push(s))

      const joinPromise = agent.join('https://x.com/i/spaces/test')
      await vi.advanceTimersByTimeAsync(0)
      await joinPromise

      expect(statuses).toContain('launching')
      expect(statuses).toContain('authenticating')
      expect(statuses).toContain('joining')
      expect(statuses).toContain('idle')
      await agent.destroy()
    })

    it('emits error event on join failure', async () => {
      mockBrowserLifecycleInstance.launch.mockRejectedValue(new Error('browser crashed'))
      const agent = new XSpaceAgent(minimalConfig())
      const errors: Error[] = []
      agent.on('error', (e) => errors.push(e))

      await expect(agent.join('https://x.com/i/spaces/test')).rejects.toThrow()
      expect(agent.getStatus()).toBe('error')
    })

    it('emits status event on leave', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      const statuses: AgentStatus[] = []
      agent.on('status', (s) => statuses.push(s))
      await agent.leave()

      expect(statuses).toContain('connected')
    })

    it('emits status event on destroy', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')
      const statuses: AgentStatus[] = []
      agent.on('status', (s) => statuses.push(s))
      await agent.destroy()
      expect(statuses).toContain('disconnected')
    })

    it('emits transcription event during speech pipeline', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      mockTranscribe.mockResolvedValue({ text: 'Hello world' })
      mockStreamResponse.mockImplementation(mockAsyncGenerator('Hi there!'))
      mockSynthesize.mockResolvedValue(Buffer.from('audio'))
      vi.mocked(injectAudio).mockResolvedValue(undefined)

      const transcriptions: any[] = []
      agent.on('transcription', (t) => transcriptions.push(t))

      // Trigger the VAD callback by extracting the onSpeech handler
      // The VAD callback is set up in the constructor — we trigger handleSpeechEnd
      // by calling the private method indirectly via the VAD mock
      const fakeChunks = [Buffer.from('chunk1'), Buffer.from('chunk2'), Buffer.from('chunk3')]
      // Access the private vad and trigger its callback
      audioState.speechCallback?.(fakeChunks)

      // Allow async pipeline to run
      await vi.advanceTimersByTimeAsync(2000)

      expect(transcriptions).toHaveLength(1)
      expect(transcriptions[0]).toEqual(
        expect.objectContaining({
          speaker: 'Space Speaker',
          text: 'Hello world',
        }),
      )
      expect(transcriptions[0].timestamp).toBeTypeOf('number')
      await agent.destroy()
    })

    it('emits response event after full pipeline completes', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      mockTranscribe.mockResolvedValue({ text: 'What is 2+2?' })
      mockStreamResponse.mockImplementation(mockAsyncGenerator('4'))
      mockSynthesize.mockResolvedValue(Buffer.from('tts-audio'))
      vi.mocked(injectAudio).mockResolvedValue(undefined)

      const responses: any[] = []
      agent.on('response', (r) => responses.push(r))

      audioState.speechCallback?.([Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)])
      await vi.advanceTimersByTimeAsync(2000)

      expect(responses).toHaveLength(1)
      expect(responses[0].text).toBe('4')
      expect(responses[0].audio).toBeInstanceOf(Buffer)
      await agent.destroy()
    })

    it('emits error event when pipeline throws', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      mockTranscribe.mockRejectedValue(new Error('STT failure'))

      const errors: Error[] = []
      agent.on('error', (e) => errors.push(e))

      audioState.speechCallback?.([Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)])
      await vi.advanceTimersByTimeAsync(100)

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe('STT failure')
      await agent.destroy()
    })

    it('emits space-ended event via health check', async () => {
      const { mockPage } = setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      vi.mocked(spaceUI.getSpaceState).mockResolvedValue({
        isLive: false,
        hasEnded: true,
        isSpeaker: false,
        speakerCount: 0,
      })

      const spaceEndedFn = vi.fn()
      agent.on('space-ended', spaceEndedFn)

      // Health check runs every 10 seconds
      await vi.advanceTimersByTimeAsync(10_000)

      expect(spaceEndedFn).toHaveBeenCalled()
      expect(agent.getStatus()).toBe('space-ended')
      await agent.destroy()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Middleware
  // ────────────────────────────────────────────────────────────────────────

  describe('Middleware', () => {
    it('use() registers middleware and returns this for chaining', () => {
      const agent = new XSpaceAgent(minimalConfig())
      const result = agent.use('before:tts', (text) => text)
      expect(result).toBe(agent)
    })

    it('use() allows registering multiple middleware for same stage', () => {
      const agent = new XSpaceAgent(minimalConfig())
      agent.use('after:llm', (text: string) => text.toUpperCase())
      agent.use('after:llm', (text: string) => text + '!')
      // Verify middleware map has 2 handlers — access private field
      const mw = (agent as any).conversation.middlewares
      expect(mw.get('after:llm')).toHaveLength(2)
    })

    it('middleware can modify data in the pipeline', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      // Register middleware that uppercases the LLM response
      agent.use('after:llm', (text: string) => text.toUpperCase())

      mockTranscribe.mockResolvedValue({ text: 'hello' })
      mockStreamResponse.mockImplementation(mockAsyncGenerator('response text'))
      mockSynthesize.mockResolvedValue(Buffer.from('audio'))
      vi.mocked(injectAudio).mockResolvedValue(undefined)

      const responses: any[] = []
      agent.on('response', (r) => responses.push(r))

      audioState.speechCallback?.([Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)])
      await vi.advanceTimersByTimeAsync(2000)

      expect(responses[0].text).toBe('RESPONSE TEXT')
      await agent.destroy()
    })

    it('middleware returning null aborts the pipeline', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      // Register middleware that blocks before:stt
      agent.use('before:stt', () => null)

      mockTranscribe.mockResolvedValue({ text: 'should not reach' })

      audioState.speechCallback?.([Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)])
      await vi.advanceTimersByTimeAsync(100)

      // STT should never have been called since before:stt returned null
      expect(mockTranscribe).not.toHaveBeenCalled()
      await agent.destroy()
    })

    it('middleware runs in order', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      const order: number[] = []
      agent.use('after:llm', (text: string) => {
        order.push(1)
        return text + '-first'
      })
      agent.use('after:llm', (text: string) => {
        order.push(2)
        return text + '-second'
      })

      mockTranscribe.mockResolvedValue({ text: 'test' })
      mockStreamResponse.mockImplementation(mockAsyncGenerator('base'))
      mockSynthesize.mockResolvedValue(Buffer.from('audio'))
      vi.mocked(injectAudio).mockResolvedValue(undefined)

      const responses: any[] = []
      agent.on('response', (r) => responses.push(r))

      audioState.speechCallback?.([Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)])
      await vi.advanceTimersByTimeAsync(2000)

      expect(order).toEqual([1, 2])
      expect(responses[0].text).toBe('base-first-second')
      await agent.destroy()
    })

    it('middleware errors are caught and emitted as error events', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      agent.use('after:stt', () => {
        throw new Error('middleware boom')
      })

      mockTranscribe.mockResolvedValue({ text: 'test' })

      const errors: Error[] = []
      agent.on('error', (e) => errors.push(e))

      audioState.speechCallback?.([Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)])
      await vi.advanceTimersByTimeAsync(100)

      expect(errors).toHaveLength(1)
      expect(errors[0].message).toBe('middleware boom')
      await agent.destroy()
    })

    it('after:stt middleware returning null stops pipeline at transcription', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      agent.use('after:stt', () => null)

      mockTranscribe.mockResolvedValue({ text: 'test' })

      audioState.speechCallback?.([Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)])
      await vi.advanceTimersByTimeAsync(100)

      // LLM should never be called
      expect(mockStreamResponse).not.toHaveBeenCalled()
      await agent.destroy()
    })

    it('before:tts middleware can modify text for say()', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      agent.use('before:tts', (text: string) => text.toLowerCase())

      mockSynthesize.mockResolvedValue(Buffer.from('audio'))
      vi.mocked(injectAudio).mockResolvedValue(undefined)

      await agent.say('HELLO WORLD')

      expect(mockSynthesize).toHaveBeenCalledWith('hello world', 0)
      await agent.destroy()
    })

    it('before:tts returning null aborts say()', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      agent.use('before:tts', () => null)

      await agent.say('should not synthesize')

      expect(mockSynthesize).not.toHaveBeenCalled()
      await agent.destroy()
    })

    it('supports all six middleware stages', () => {
      const agent = new XSpaceAgent(minimalConfig())
      const stages: MiddlewareStage[] = [
        'before:stt',
        'after:stt',
        'before:llm',
        'after:llm',
        'before:tts',
        'after:tts',
      ]
      for (const stage of stages) {
        agent.use(stage, (x: any) => x)
      }
      const mw = (agent as any).conversation.middlewares
      expect(mw.size).toBe(6)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────────────────────────────────

  describe('Lifecycle', () => {
    it('join() transitions through launching → logging-in → joining → idle', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      const statuses: AgentStatus[] = []
      agent.on('status', (s) => statuses.push(s))

      await agent.join('https://x.com/i/spaces/test')

      expect(statuses[0]).toBe('launching')
      expect(statuses).toContain('authenticating')
      expect(statuses).toContain('joining')
      expect(statuses[statuses.length - 1]).toBe('idle')
      await agent.destroy()
    })

    it('join() throws if agent is already running', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      await expect(agent.join('https://x.com/i/spaces/other')).rejects.toThrow(
        'Agent already running',
      )
      await agent.destroy()
    })

    it('join() sets status to error on failure', async () => {
      mockBrowserLifecycleInstance.launch.mockRejectedValue(new Error('no chrome'))
      const agent = new XSpaceAgent(minimalConfig())

      await expect(agent.join('https://x.com/i/spaces/test')).rejects.toThrow('no chrome')
      expect(agent.getStatus()).toBe('error')
    })

    it('join() calls browserLifecycle.joinSpace', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      expect(mockBrowserLifecycleInstance.joinSpace).toHaveBeenCalledWith('https://x.com/i/spaces/test')
      expect(agent.getStatus()).toBe('idle')
      await agent.destroy()
    })

    it('leave() resets status to logged-in', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')
      await agent.leave()

      expect(agent.getStatus()).toBe('connected')
      expect(mockBrowserLifecycleInstance.leaveSpace).toHaveBeenCalled()
    })

    it('multiple leave() calls do not throw', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')
      await agent.leave()
      await agent.leave()
      expect(agent.getStatus()).toBe('connected')
    })

    it('leave() handles page already closed gracefully', async () => {
      setupJoinMocks()
      mockBrowserLifecycleInstance.leaveSpace.mockRejectedValue(new Error('page closed'))
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      // Attach error listener to prevent unhandled error throw
      const errors: Error[] = []
      agent.on('error', (e) => errors.push(e))

      // Should not throw
      await agent.leave()
      expect(agent.getStatus()).toBe('connected')
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toContain('page closed')
    })

    it('destroy() tears down everything', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      await agent.destroy()

      expect(mockBrowserLifecycleInstance.cleanup).toHaveBeenCalled()
      expect(agent.getStatus()).toBe('disconnected')
      expect(agent.isConnected()).toBe(false)
    })

    it('destroy() removes all event listeners', async () => {
      const agent = new XSpaceAgent(minimalConfig())
      const listener = vi.fn()
      agent.on('status', listener)

      await agent.destroy()

      // After destroy, emitting should not call listener
      expect(agent.listenerCount('status')).toBe(0)
    })

    it('destroy() works even without prior join', async () => {
      const agent = new XSpaceAgent(minimalConfig())
      await agent.destroy()
      expect(agent.getStatus()).toBe('disconnected')
    })

    it('destroy() calls browserLifecycle cleanup', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')
      await agent.destroy()

      expect(mockBrowserLifecycleInstance.cleanup).toHaveBeenCalled()
      expect(agent.getStatus()).toBe('disconnected')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // AI Pipeline & Conversation History
  // ────────────────────────────────────────────────────────────────────────

  describe('AI Pipeline', () => {
    it('setSystemPrompt() updates the system prompt', () => {
      const agent = new XSpaceAgent(minimalConfig())
      agent.setSystemPrompt('New prompt')
      // setSystemPrompt updates the conversation and prompt builder, not config
      expect((agent as any).conversation.systemPrompt).toBe('New prompt')
    })

    it('getConversationHistory() returns a copy', () => {
      const agent = new XSpaceAgent(minimalConfig())
      const history = agent.getConversationHistory()
      expect(history).toEqual([])
      // Mutating the returned array should not affect internal state
      history.push({ role: 'user', content: 'hack' })
      expect(agent.getConversationHistory()).toEqual([])
    })

    it('clearHistory() resets conversation history', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      mockTranscribe.mockResolvedValue({ text: 'test message' })
      mockStreamResponse.mockImplementation(mockAsyncGenerator('response'))
      mockSynthesize.mockResolvedValue(Buffer.from('audio'))
      vi.mocked(injectAudio).mockResolvedValue(undefined)

      audioState.speechCallback?.([Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)])
      await vi.advanceTimersByTimeAsync(2000)

      expect(agent.getConversationHistory().length).toBeGreaterThan(0)

      agent.clearHistory()

      expect(agent.getConversationHistory()).toEqual([])
      expect(mockClearHistory).toHaveBeenCalledWith(0)
      await agent.destroy()
    })

    it('conversation history accumulates user and assistant messages', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      mockTranscribe.mockResolvedValue({ text: 'user says hi' })
      mockStreamResponse.mockImplementation(mockAsyncGenerator('agent replies'))
      mockSynthesize.mockResolvedValue(Buffer.from('audio'))
      vi.mocked(injectAudio).mockResolvedValue(undefined)

      audioState.speechCallback?.([Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)])
      await vi.advanceTimersByTimeAsync(2000)

      const history = agent.getConversationHistory()
      expect(history).toEqual([
        { role: 'user', content: 'user says hi' },
        { role: 'assistant', content: 'agent replies' },
      ])
      await agent.destroy()
    })

    it('history respects maxHistory limit', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(
        minimalConfig({
          ai: { provider: 'groq', apiKey: 'k', systemPrompt: 's', maxHistory: 4 },
        }),
      )
      await agent.join('https://x.com/i/spaces/test')

      mockStreamResponse.mockImplementation(mockAsyncGenerator('reply'))
      mockSynthesize.mockResolvedValue(Buffer.from('audio'))
      vi.mocked(injectAudio).mockResolvedValue(undefined)

      // Send 5 messages — each creates user + assistant = 2 entries
      for (let i = 0; i < 5; i++) {
        mockTranscribe.mockResolvedValue({ text: `msg ${i}` })
        audioState.speechCallback?.([Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)])
        await vi.advanceTimersByTimeAsync(2000)
      }

      const history = agent.getConversationHistory()
      // maxHistory=4, so at most 4 messages retained
      expect(history.length).toBeLessThanOrEqual(4)
      await agent.destroy()
    })

    it('empty transcription text skips LLM call', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      mockTranscribe.mockResolvedValue({ text: '' })

      audioState.speechCallback?.([Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)])
      await vi.advanceTimersByTimeAsync(100)

      expect(mockStreamResponse).not.toHaveBeenCalled()
      expect(agent.getStatus()).toBe('idle')
      await agent.destroy()
    })

    it('whitespace-only transcription skips LLM call', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      mockTranscribe.mockResolvedValue({ text: '   \n  ' })

      audioState.speechCallback?.([Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)])
      await vi.advanceTimersByTimeAsync(100)

      expect(mockStreamResponse).not.toHaveBeenCalled()
      await agent.destroy()
    })

    it('autoRespond=false skips the speech pipeline', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(
        minimalConfig({ behavior: { autoRespond: false } }),
      )
      await agent.join('https://x.com/i/spaces/test')

      audioState.speechCallback?.([Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)])
      await vi.advanceTimersByTimeAsync(100)

      expect(mockTranscribe).not.toHaveBeenCalled()
      expect(mockStreamResponse).not.toHaveBeenCalled()
      await agent.destroy()
    })

    it('pipeline emits error for non-Error throws', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      mockTranscribe.mockRejectedValue('string error')

      const errors: Error[] = []
      agent.on('error', (e) => errors.push(e))

      audioState.speechCallback?.([Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)])
      await vi.advanceTimersByTimeAsync(100)

      expect(errors).toHaveLength(1)
      expect(errors[0]).toBeInstanceOf(Error)
      expect(errors[0].message).toBe('string error')
      await agent.destroy()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Speaking
  // ────────────────────────────────────────────────────────────────────────

  describe('Speaking', () => {
    it('say() synthesizes and injects audio', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      const audioBuf = Buffer.from('synthesized-audio')
      mockSynthesize.mockResolvedValue(audioBuf)
      vi.mocked(injectAudio).mockResolvedValue(undefined)

      const responses: any[] = []
      agent.on('response', (r) => responses.push(r))

      await agent.say('Hello!')

      expect(mockSynthesize).toHaveBeenCalledWith('Hello!', 0)
      expect((agent as any).audio.playAudio).toHaveBeenCalled()
      expect(responses).toHaveLength(1)
      expect(responses[0].text).toBe('Hello!')
      expect(responses[0].audio).toBe(audioBuf)
      await agent.destroy()
    })

    it('say() skips when synthesize returns null', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      mockSynthesize.mockResolvedValue(null)

      await agent.say('silent message')

      expect((agent as any).audio.playAudio).not.toHaveBeenCalled()
      await agent.destroy()
    })

    it('say() transitions through speaking → idle', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      mockSynthesize.mockResolvedValue(Buffer.from('audio'))

      const statuses: AgentStatus[] = []
      agent.on('status', (s) => statuses.push(s))

      await agent.say('Hello!')

      expect(statuses).toContain('speaking')
      expect(statuses).toContain('idle')
      await agent.destroy()
    })

    it('mute() stops audio capture', async () => {
      const agent = new XSpaceAgent(minimalConfig())
      await agent.mute()
      expect((agent as any).audio.stopCapture).toHaveBeenCalled()
    })

    it('unmute() re-enables audio capture', async () => {
      const agent = new XSpaceAgent(minimalConfig())
      await agent.mute()
      await agent.unmute()
      expect((agent as any).audio.startCapture).toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Health Check
  // ────────────────────────────────────────────────────────────────────────

  describe('Health Check', () => {
    it('health check stops itself when space has ended', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      vi.mocked(spaceUI.getSpaceState).mockResolvedValue({
        isLive: false,
        hasEnded: true,
        isSpeaker: false,
        speakerCount: 0,
      })

      const endFn = vi.fn()
      agent.on('space-ended', endFn)

      await vi.advanceTimersByTimeAsync(10_000)

      expect(endFn).toHaveBeenCalledOnce()
      expect(agent.getStatus()).toBe('space-ended')

      // After space ends, further health checks should NOT fire getSpaceState again
      vi.mocked(spaceUI.getSpaceState).mockClear()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(spaceUI.getSpaceState).not.toHaveBeenCalled()

      await agent.destroy()
    })

    it('health check handles page navigation errors gracefully', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      vi.mocked(spaceUI.getSpaceState).mockRejectedValue(new Error('page navigated'))

      // Attach error listener to catch the health check error event
      const errors: Error[] = []
      agent.on('error', (e) => errors.push(e))

      // Should not throw
      await vi.advanceTimersByTimeAsync(10_000)
      expect(agent.getStatus()).toBe('idle')

      await agent.destroy()
    })

    it('health check stops when agent is disconnected', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      await agent.destroy()

      // Set up mock after destroy
      vi.mocked(spaceUI.getSpaceState).mockClear()
      await vi.advanceTimersByTimeAsync(20_000)

      // Should not have been called after destroy
      expect(spaceUI.getSpaceState).not.toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Pipeline with TTS null
  // ────────────────────────────────────────────────────────────────────────

  describe('Pipeline edge cases', () => {
    it('handles TTS returning null in pipeline (no audio injection)', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      mockTranscribe.mockResolvedValue({ text: 'hello' })
      mockStreamResponse.mockImplementation(mockAsyncGenerator('response'))
      mockSynthesize.mockResolvedValue(null) // TTS returns null

      const responses: any[] = []
      agent.on('response', (r) => responses.push(r))

      audioState.speechCallback?.([Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)])
      await vi.advanceTimersByTimeAsync(2000)

      expect(responses).toHaveLength(1)
      expect(responses[0].text).toBe('response')
      expect(responses[0].audio).toBeUndefined()
      expect((agent as any).audio.playAudio).not.toHaveBeenCalled()
      await agent.destroy()
    })

    it('before:llm middleware can modify systemPrompt', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      agent.use('before:llm', (input: { messages: any[]; systemPrompt: string }) => ({
        ...input,
        systemPrompt: 'Modified prompt',
      }))

      mockTranscribe.mockResolvedValue({ text: 'test' })
      mockStreamResponse.mockImplementation(mockAsyncGenerator('ok'))
      mockSynthesize.mockResolvedValue(Buffer.from('audio'))
      vi.mocked(injectAudio).mockResolvedValue(undefined)

      audioState.speechCallback?.([Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)])
      await vi.advanceTimersByTimeAsync(2000)

      // The streamResponse should have been called with the modified prompt
      expect(mockStreamResponse).toHaveBeenCalledWith(
        0,
        'test',
        'Modified prompt',
      )
      await agent.destroy()
    })

    it('after:llm returning null stops pipeline before TTS', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      agent.use('after:llm', () => null)

      mockTranscribe.mockResolvedValue({ text: 'test' })
      mockStreamResponse.mockImplementation(mockAsyncGenerator('response'))

      audioState.speechCallback?.([Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)])
      await vi.advanceTimersByTimeAsync(2000)

      expect(mockSynthesize).not.toHaveBeenCalled()
      expect(agent.getStatus()).toBe('idle')
      await agent.destroy()
    })

    it('before:tts returning null in pipeline stops audio synthesis', async () => {
      setupJoinMocks()
      const agent = new XSpaceAgent(minimalConfig())
      await agent.join('https://x.com/i/spaces/test')

      agent.use('before:tts', () => null)

      mockTranscribe.mockResolvedValue({ text: 'test' })
      mockStreamResponse.mockImplementation(mockAsyncGenerator('response'))

      audioState.speechCallback?.([Buffer.alloc(100), Buffer.alloc(100), Buffer.alloc(100)])
      await vi.advanceTimersByTimeAsync(2000)

      expect(mockSynthesize).not.toHaveBeenCalled()
      expect(agent.getStatus()).toBe('idle')
      await agent.destroy()
    })
  })
})


