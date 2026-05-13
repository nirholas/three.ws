// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'

// =============================================================================
// Hoisted mocks — must be defined before vi.mock() factories
// =============================================================================

const {
  mockStreamResponse,
  mockClearHistory,
  mockTranscribe,
  mockSynthesize,
  mockBrowserLifecycleInstance,
  audioState,
} = vi.hoisted(() => {
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

// =============================================================================
// Module mocks
// =============================================================================

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

vi.mock('../../src/browser/lifecycle', () => ({
  BrowserLifecycle: vi.fn().mockImplementation(function (this: any) {
    for (const key of Object.keys(mockBrowserLifecycleInstance._listeners)) {
      delete mockBrowserLifecycleInstance._listeners[key]
    }
    Object.assign(this, mockBrowserLifecycleInstance)
  }),
}))

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
      this.synthesize = vi.fn().mockImplementation((...args: any[]) => mockSynthesize(...args))
      this.playAudio = vi.fn().mockResolvedValue(undefined)
    }),
  }
})

vi.mock('../../src/pipeline/llm', () => ({
  createLLM: vi.fn().mockImplementation(() => ({
    name: 'mock-llm',
    type: 'socket',
    streamResponse: mockStreamResponse,
    clearHistory: mockClearHistory,
    getMetrics: vi.fn().mockReturnValue({
      requestCount: 0, successCount: 0, errorCount: 0,
      totalInputTokens: 0, totalOutputTokens: 0,
      avgLatencyMs: 0, avgTimeToFirstTokenMs: 0,
    }),
    estimateCost: vi.fn().mockReturnValue(0),
    checkHealth: vi.fn().mockResolvedValue({ ok: true, latencyMs: 10 }),
  })),
}))

vi.mock('../../src/pipeline/stt', () => ({
  createSTT: vi.fn().mockImplementation(() => ({
    name: 'mock-stt',
    transcribe: mockTranscribe,
    getMetrics: vi.fn().mockReturnValue({
      requestCount: 0, successCount: 0, errorCount: 0,
      totalInputTokens: 0, totalOutputTokens: 0,
      avgLatencyMs: 0, avgTimeToFirstTokenMs: 0,
    }),
    estimateCost: vi.fn().mockReturnValue(0),
    checkHealth: vi.fn().mockResolvedValue({ ok: true, latencyMs: 5 }),
  })),
}))

vi.mock('../../src/pipeline/tts', () => {
  const makeMockTTS = () => ({
    name: 'mock-tts',
    synthesize: mockSynthesize,
    getMetrics: vi.fn().mockReturnValue({
      requestCount: 0, successCount: 0, errorCount: 0,
      totalInputTokens: 0, totalOutputTokens: 0,
      avgLatencyMs: 0, avgTimeToFirstTokenMs: 0,
    }),
    estimateCost: vi.fn().mockReturnValue(0),
    checkHealth: vi.fn().mockResolvedValue({ ok: true, latencyMs: 5 }),
  })
  return {
    createTTS: vi.fn().mockImplementation(makeMockTTS),
    createTTSWithFallback: vi.fn().mockImplementation(makeMockTTS),
  }
})

vi.mock('../../src/audio/bridge', () => ({
  injectAudioHooks: vi.fn(),
  injectAudio: vi.fn(),
  pcmChunksToWav: vi.fn().mockReturnValue(Buffer.from('fake-wav')),
}))

// =============================================================================
// Import the agent after all mocks are established
// =============================================================================

import { XSpaceAgent } from '../../src/agent'
import type { AgentConfig } from '../../src/types'

// =============================================================================
// Helpers
// =============================================================================

function createDefaultConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    auth: { token: 'test-token' },
    ai: {
      provider: 'openai',
      apiKey: 'test-key',
      systemPrompt: 'You are a helpful AI assistant in an X Space.',
      maxTokens: 300,
    },
    voice: { provider: 'openai', apiKey: 'test-key' },
    browser: { headless: true },
    behavior: {
      autoRespond: true,
      silenceThreshold: 1.5,
    },
    ...overrides,
  }
}

/** Helper to create an async iterable from an array of strings. */
function createAsyncIterable(chunks: string[]): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        async next() {
          if (index < chunks.length) {
            return { value: chunks[index++], done: false }
          }
          return { value: undefined, done: true }
        },
      }
    },
  }
}

/** Trigger the speech detection callback registered by the AudioPipeline mock. */
function triggerSpeechDetected(chunks?: Buffer[]): void {
  const speechChunks = chunks ?? [Buffer.from('fake-audio-data')]
  if (audioState.speechCallback) {
    audioState.speechCallback(speechChunks)
  }
}

/** Wait for an event to be emitted on the agent, with a timeout. */
function waitForEvent(
  emitter: EventEmitter,
  event: string,
  timeoutMs = 3000,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}" event`)),
      timeoutMs,
    )
    emitter.once(event, (...args: any[]) => {
      clearTimeout(timer)
      resolve(args.length === 1 ? args[0] : args)
    })
  })
}

// =============================================================================
// Tests
// =============================================================================

describe('Full Pipeline Integration', () => {
  let agent: XSpaceAgent

  beforeEach(() => {
    vi.clearAllMocks()
    audioState.speechCallback = null
  })

  afterEach(async () => {
    if (agent) {
      try {
        await agent.destroy()
      } catch {
        // Ignore cleanup errors in tests
      }
    }
  })

  // ── 1. End-to-end pipeline: STT -> LLM -> TTS ───────────────────────────

  describe('end-to-end pipeline flow', () => {
    it('should process speech through STT -> LLM -> TTS and emit events', async () => {
      // Set up mocks for the full pipeline
      mockTranscribe.mockResolvedValue({ text: 'What is the weather today?' })
      mockStreamResponse.mockReturnValue(
        createAsyncIterable(['It is ', 'sunny ', 'and 72F.']),
      )
      mockSynthesize.mockResolvedValue(Buffer.from('synthesized-audio'))

      agent = new XSpaceAgent(createDefaultConfig())

      // Collect emitted events
      const events: { type: string; data: any }[] = []
      agent.on('transcription', (data) => events.push({ type: 'transcription', data }))
      agent.on('response', (data) => events.push({ type: 'response', data }))
      agent.on('error', (data) => events.push({ type: 'error', data }))

      // Wait for both transcription and response events
      const transcriptionPromise = waitForEvent(agent, 'transcription')
      const responsePromise = waitForEvent(agent, 'response')

      // Trigger speech detection
      triggerSpeechDetected()

      // Wait for the full pipeline to complete
      const transcription = await transcriptionPromise
      const response = await responsePromise

      // Verify transcription event
      expect(transcription).toBeDefined()
      expect(transcription.text).toBe('What is the weather today?')
      // Speaker falls back to 'Space Speaker' when browser page is not available
      expect(transcription.speaker).toBe('Space Speaker')
      expect(transcription.timestamp).toBeGreaterThan(0)

      // Verify response event
      expect(response).toBeDefined()
      expect(response.text).toBe('It is sunny and 72F.')
      expect(response.audio).toBeInstanceOf(Buffer)

      // Verify the pipeline was called in order
      expect(mockTranscribe).toHaveBeenCalledOnce()
      expect(mockStreamResponse).toHaveBeenCalledOnce()
      expect(mockSynthesize).toHaveBeenCalledWith('It is sunny and 72F.')
    })

    it('should pass the transcribed text to the LLM', async () => {
      mockTranscribe.mockResolvedValue({ text: 'Tell me a joke' })
      mockStreamResponse.mockReturnValue(
        createAsyncIterable(['Why did the chicken cross the road?']),
      )
      mockSynthesize.mockResolvedValue(Buffer.from('audio'))

      agent = new XSpaceAgent(createDefaultConfig())

      const responsePromise = waitForEvent(agent, 'response')
      triggerSpeechDetected()
      await responsePromise

      // The LLM should receive the transcribed text
      expect(mockStreamResponse).toHaveBeenCalledWith(
        0,
        'Tell me a joke',
        expect.stringContaining('helpful'),
      )
    })

    it('should handle streaming LLM responses by concatenating chunks', async () => {
      mockTranscribe.mockResolvedValue({ text: 'Hello' })
      mockStreamResponse.mockReturnValue(
        createAsyncIterable(['chunk1', ' chunk2', ' chunk3']),
      )
      mockSynthesize.mockResolvedValue(Buffer.from('audio'))

      agent = new XSpaceAgent(createDefaultConfig())

      const responsePromise = waitForEvent(agent, 'response')
      triggerSpeechDetected()
      const response = await responsePromise

      expect(response.text).toBe('chunk1 chunk2 chunk3')
    })
  })

  // ── 2. Empty / no transcription ──────────────────────────────────────────

  describe('empty transcription handling', () => {
    it('should not call LLM when transcription is empty', async () => {
      mockTranscribe.mockResolvedValue({ text: '' })

      agent = new XSpaceAgent(createDefaultConfig())

      // Give the pipeline time to process
      triggerSpeechDetected()
      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(mockStreamResponse).not.toHaveBeenCalled()
      expect(mockSynthesize).not.toHaveBeenCalled()
    })

    it('should not call LLM when transcription is whitespace-only', async () => {
      mockTranscribe.mockResolvedValue({ text: '   \n  ' })

      agent = new XSpaceAgent(createDefaultConfig())

      triggerSpeechDetected()
      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(mockStreamResponse).not.toHaveBeenCalled()
    })
  })

  // ── 3. Event emission verification ───────────────────────────────────────

  describe('event emission', () => {
    it('should emit transcription event with speaker identity', async () => {
      mockTranscribe.mockResolvedValue({ text: 'Hello from the speaker' })
      mockStreamResponse.mockReturnValue(createAsyncIterable(['Hi!']))
      mockSynthesize.mockResolvedValue(Buffer.from('audio'))

      agent = new XSpaceAgent(createDefaultConfig())

      const transcriptionPromise = waitForEvent(agent, 'transcription')
      triggerSpeechDetected()
      const event = await transcriptionPromise

      // Speaker falls back to 'Space Speaker' when no browser page is available
      expect(event.speaker).toBe('Space Speaker')
      expect(event.text).toBe('Hello from the speaker')
      expect(typeof event.timestamp).toBe('number')
    })

    it('should emit response event with text and audio buffer', async () => {
      const audioBuffer = Buffer.from('tts-output-audio-data')
      mockTranscribe.mockResolvedValue({ text: 'Question?' })
      mockStreamResponse.mockReturnValue(createAsyncIterable(['Answer.']))
      mockSynthesize.mockResolvedValue(audioBuffer)

      agent = new XSpaceAgent(createDefaultConfig())

      const responsePromise = waitForEvent(agent, 'response')
      triggerSpeechDetected()
      const response = await responsePromise

      expect(response.text).toBe('Answer.')
      expect(response.audio).toBe(audioBuffer)
    })

    it('should emit error event when STT fails', async () => {
      mockTranscribe.mockRejectedValue(new Error('STT service unavailable'))

      agent = new XSpaceAgent(createDefaultConfig())

      const errorPromise = waitForEvent(agent, 'error')
      triggerSpeechDetected()
      const error = await errorPromise

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('STT service unavailable')
    })

    it('should emit error event when LLM fails', async () => {
      mockTranscribe.mockResolvedValue({ text: 'Hello' })
      mockStreamResponse.mockImplementation(function* () {
        throw new Error('LLM rate limited')
      })

      agent = new XSpaceAgent(createDefaultConfig())

      const errorPromise = waitForEvent(agent, 'error')
      triggerSpeechDetected()
      const error = await errorPromise

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('LLM rate limited')
    })

    it('should emit error event when TTS fails', async () => {
      mockTranscribe.mockResolvedValue({ text: 'Hello' })
      mockStreamResponse.mockReturnValue(createAsyncIterable(['Response']))
      mockSynthesize.mockRejectedValue(new Error('TTS quota exceeded'))

      agent = new XSpaceAgent(createDefaultConfig())

      const errorPromise = waitForEvent(agent, 'error')
      triggerSpeechDetected()
      const error = await errorPromise

      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('TTS quota exceeded')
    })
  })

  // ── 4. Conversation history ──────────────────────────────────────────────

  describe('conversation history', () => {
    it('should accumulate conversation across multiple turns', async () => {
      let turnCount = 0
      mockTranscribe
        .mockResolvedValueOnce({ text: 'First question' })
        .mockResolvedValueOnce({ text: 'Follow-up question' })

      mockStreamResponse
        .mockReturnValueOnce(createAsyncIterable(['First answer']))
        .mockReturnValueOnce(createAsyncIterable(['Second answer']))

      mockSynthesize.mockResolvedValue(Buffer.from('audio'))

      agent = new XSpaceAgent(createDefaultConfig())

      // Turn 1
      const response1Promise = waitForEvent(agent, 'response')
      triggerSpeechDetected()
      await response1Promise

      // Turn 2
      const response2Promise = waitForEvent(agent, 'response')
      triggerSpeechDetected()
      await response2Promise

      // Both turns should have been processed
      expect(mockStreamResponse).toHaveBeenCalledTimes(2)
      expect(mockTranscribe).toHaveBeenCalledTimes(2)
      expect(mockSynthesize).toHaveBeenCalledTimes(2)
    })
  })

  // ── 5. Error recovery ───────────────────────────────────────────────────

  describe('error recovery', () => {
    it('should recover and process next turn after STT failure', async () => {
      // First turn: STT fails
      mockTranscribe.mockRejectedValueOnce(new Error('STT temporary failure'))
      // Second turn: STT succeeds
      mockTranscribe.mockResolvedValueOnce({ text: 'After recovery' })
      mockStreamResponse.mockReturnValue(createAsyncIterable(['Recovered response']))
      mockSynthesize.mockResolvedValue(Buffer.from('audio'))

      agent = new XSpaceAgent(createDefaultConfig())

      // First turn - error
      const errorPromise = waitForEvent(agent, 'error')
      triggerSpeechDetected()
      await errorPromise

      // Second turn - should succeed
      const responsePromise = waitForEvent(agent, 'response')
      triggerSpeechDetected()
      const response = await responsePromise

      expect(response.text).toBe('Recovered response')
    })

    it('should recover and process next turn after LLM failure', async () => {
      // First turn: LLM fails
      mockTranscribe.mockResolvedValue({ text: 'Hello' })
      mockStreamResponse
        .mockImplementationOnce(function* () {
          throw new Error('LLM timeout')
        })
        .mockReturnValueOnce(createAsyncIterable(['Success after retry']))

      mockSynthesize.mockResolvedValue(Buffer.from('audio'))

      agent = new XSpaceAgent(createDefaultConfig())

      // First turn - error
      const errorPromise = waitForEvent(agent, 'error')
      triggerSpeechDetected()
      await errorPromise

      // Second turn - should succeed
      const responsePromise = waitForEvent(agent, 'response')
      triggerSpeechDetected()
      const response = await responsePromise

      expect(response.text).toBe('Success after retry')
    })

    it('should recover and process next turn after TTS failure', async () => {
      mockTranscribe
        .mockResolvedValueOnce({ text: 'First' })
        .mockResolvedValueOnce({ text: 'Second' })

      mockStreamResponse
        .mockReturnValueOnce(createAsyncIterable(['Response 1']))
        .mockReturnValueOnce(createAsyncIterable(['Response 2']))

      // First TTS fails, second succeeds
      mockSynthesize
        .mockRejectedValueOnce(new Error('TTS failed'))
        .mockResolvedValueOnce(Buffer.from('audio'))

      agent = new XSpaceAgent(createDefaultConfig())

      // First turn - TTS error
      const errorPromise = waitForEvent(agent, 'error')
      triggerSpeechDetected()
      await errorPromise

      // Second turn - should succeed
      const responsePromise = waitForEvent(agent, 'response')
      triggerSpeechDetected()
      const response = await responsePromise

      expect(response.text).toBe('Response 2')
    })
  })

  // ── 6. Auto-respond disabled ─────────────────────────────────────────────

  describe('behavior configuration', () => {
    it('should not process speech when autoRespond is false', async () => {
      mockTranscribe.mockResolvedValue({ text: 'Should be ignored' })

      agent = new XSpaceAgent(
        createDefaultConfig({
          behavior: { autoRespond: false },
        }),
      )

      triggerSpeechDetected()
      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(mockTranscribe).not.toHaveBeenCalled()
      expect(mockStreamResponse).not.toHaveBeenCalled()
    })
  })

  // ── 7. Null TTS output (browser TTS) ────────────────────────────────────

  describe('browser TTS mode', () => {
    it('should emit response without audio when TTS returns null', async () => {
      mockTranscribe.mockResolvedValue({ text: 'Hello' })
      mockStreamResponse.mockReturnValue(createAsyncIterable(['Browser-spoken']))
      mockSynthesize.mockResolvedValue(null) // Browser TTS returns null

      agent = new XSpaceAgent(createDefaultConfig())

      const responsePromise = waitForEvent(agent, 'response')
      triggerSpeechDetected()
      const response = await responsePromise

      expect(response.text).toBe('Browser-spoken')
      expect(response.audio).toBeUndefined()
    })
  })

  // ── 8. Multiple sequential turns ─────────────────────────────────────────

  describe('sequential pipeline invocations', () => {
    it('should handle three consecutive speech turns correctly', async () => {
      const transcriptions = ['Turn 1', 'Turn 2', 'Turn 3']
      const responses = ['Reply 1', 'Reply 2', 'Reply 3']

      for (let i = 0; i < 3; i++) {
        mockTranscribe.mockResolvedValueOnce({ text: transcriptions[i] })
        mockStreamResponse.mockReturnValueOnce(createAsyncIterable([responses[i]]))
      }
      mockSynthesize.mockResolvedValue(Buffer.from('audio'))

      agent = new XSpaceAgent(createDefaultConfig())

      const collectedResponses: string[] = []
      agent.on('response', (evt) => collectedResponses.push(evt.text))

      for (let i = 0; i < 3; i++) {
        const responsePromise = waitForEvent(agent, 'response')
        triggerSpeechDetected()
        await responsePromise
      }

      expect(collectedResponses).toEqual(['Reply 1', 'Reply 2', 'Reply 3'])
      expect(mockTranscribe).toHaveBeenCalledTimes(3)
      expect(mockStreamResponse).toHaveBeenCalledTimes(3)
    })
  })
})


