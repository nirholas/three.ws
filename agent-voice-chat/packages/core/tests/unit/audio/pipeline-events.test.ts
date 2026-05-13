// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AudioPipeline } from '../../../src/audio/pipeline'
import type { STTProvider, TTSProvider } from '../../../src/types'

describe('AudioPipeline events', () => {
  let pipeline: AudioPipeline
  let mockSTT: STTProvider
  let mockTTS: TTSProvider

  beforeEach(() => {
    vi.useFakeTimers()

    mockSTT = {
      name: 'mock-stt',
      transcribe: vi.fn().mockResolvedValue({ text: 'hello' }),
      checkHealth: vi.fn().mockResolvedValue({ ok: true, latencyMs: 10 }),
      getMetrics: vi.fn().mockReturnValue({}),
      estimateCost: vi.fn().mockReturnValue(0),
    } as any

    mockTTS = {
      synthesize: vi.fn().mockResolvedValue(Buffer.from('audio')),
    }

    pipeline = new AudioPipeline(
      {
        postSpeakDelayMs: 100,
        vad: { silenceThresholdMs: 500, minChunks: 2 },
        webrtcMonitoring: false, // Disable — no page available
      },
      mockSTT,
      mockTTS,
    )
  })

  afterEach(() => {
    pipeline.destroy()
    vi.useRealTimers()
  })

  it('should emit audio:capture-started on startCapture', () => {
    const listener = vi.fn()
    pipeline.on('audio:capture-started', listener)

    pipeline.startCapture()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('should emit audio:capture-stopped on stopCapture', () => {
    const listener = vi.fn()
    pipeline.on('audio:capture-stopped', listener)

    pipeline.startCapture()
    pipeline.stopCapture()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('should emit audio:level periodically when capture is active', () => {
    const listener = vi.fn()
    pipeline.on('audio:level', listener)

    pipeline.startCapture()
    vi.advanceTimersByTime(300) // 3 intervals at 100ms default

    expect(listener).toHaveBeenCalledTimes(3)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ inbound: expect.any(Number), outbound: expect.any(Number), peak: expect.any(Number) }),
    )

    pipeline.stopCapture()
  })

  it('should stop emitting audio:level after stopCapture', () => {
    const listener = vi.fn()
    pipeline.on('audio:level', listener)

    pipeline.startCapture()
    vi.advanceTimersByTime(200)
    const countBefore = listener.mock.calls.length

    pipeline.stopCapture()
    vi.advanceTimersByTime(500)

    expect(listener.mock.calls.length).toBe(countBefore)
  })

  it('should emit audio:echo-detected when echo is detected during injection', () => {
    const listener = vi.fn()
    pipeline.on('audio:echo-detected', listener)

    pipeline.startCapture()
    const handler = pipeline.getAudioDataHandler()

    // Simulate echo canceller being in injection mode
    // We need to trigger echo detection through the handler
    // First, put the pipeline in injecting state by accessing internal echoCanceller
    ;(pipeline as any).echoCanceller.setInjecting(true, 0.1)

    // Feed a frame that looks like echo (low energy compared to injection)
    const echoFrame = new Float32Array(4096).fill(0.01)
    const buf = Buffer.from(echoFrame.buffer)
    handler(buf.toString('base64'), 16000)

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ energy: expect.any(Number) }))

    pipeline.stopCapture()
  })

  it('should emit audio:vad-speech when VAD detects speech end', () => {
    const listener = vi.fn()
    pipeline.on('audio:vad-speech', listener)

    const speechHandler = vi.fn()
    pipeline.onSpeechDetected(speechHandler)

    pipeline.startCapture()
    const handler = pipeline.getAudioDataHandler()

    // Feed speech chunks
    for (let i = 0; i < 3; i++) {
      const speech = new Float32Array(4096).fill(0.5)
      const buf = Buffer.from(speech.buffer)
      handler(buf.toString('base64'), 16000)
    }

    // Feed silence to trigger VAD
    const silence = new Float32Array(4096).fill(0)
    const silBuf = Buffer.from(silence.buffer)
    handler(silBuf.toString('base64'), 16000)

    vi.advanceTimersByTime(600)

    expect(speechHandler).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledTimes(1)

    pipeline.stopCapture()
  })

  it('should provide audio levels via getAudioLevels', () => {
    const levels = pipeline.getAudioLevels()
    expect(levels).toHaveProperty('inbound')
    expect(levels).toHaveProperty('outbound')
    expect(levels).toHaveProperty('peak')
  })

  it('should provide WebRTC stats via getWebRTCStats', () => {
    const stats = pipeline.getWebRTCStats()
    expect(stats).toHaveProperty('packetsLost')
    expect(stats).toHaveProperty('jitter')
    expect(stats).toHaveProperty('roundTripTime')
    expect(stats).toHaveProperty('bytesReceived')
  })

  it('should clean up on destroy', () => {
    const listener = vi.fn()
    pipeline.on('audio:level', listener)

    pipeline.startCapture()
    pipeline.destroy()

    vi.advanceTimersByTime(500)
    // No more events after destroy
    expect(listener.mock.calls.length).toBe(0)
  })
})


