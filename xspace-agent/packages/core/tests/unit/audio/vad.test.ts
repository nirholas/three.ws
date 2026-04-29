// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VoiceActivityDetector } from '../../../src/audio/vad'

describe('VoiceActivityDetector', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeSpeechChunk(): string {
    // Create a Float32Array with values above the 0.001 threshold
    const float32 = new Float32Array(4096).fill(0.5)
    const buffer = Buffer.from(float32.buffer)
    return buffer.toString('base64')
  }

  function makeSilenceChunk(): string {
    // Create a Float32Array with all zeros (below threshold)
    const float32 = new Float32Array(4096).fill(0)
    const buffer = Buffer.from(float32.buffer)
    return buffer.toString('base64')
  }

  it('should use default options', () => {
    const vad = new VoiceActivityDetector()
    // Should not throw
    vad.destroy()
  })

  it('should accept custom options', () => {
    const vad = new VoiceActivityDetector({
      silenceThresholdMs: 2000,
      minChunks: 5,
    })
    vad.destroy()
  })

  it('should accumulate speech chunks', () => {
    const vad = new VoiceActivityDetector()
    const callback = vi.fn()
    vad.onSpeech(callback)

    // Feed speech chunks
    vad.feed(makeSpeechChunk())
    vad.feed(makeSpeechChunk())
    vad.feed(makeSpeechChunk())

    // No callback yet — no silence detected
    expect(callback).not.toHaveBeenCalled()
    vad.destroy()
  })

  it('should fire callback after speech followed by silence threshold', () => {
    const vad = new VoiceActivityDetector({ silenceThresholdMs: 1000, minChunks: 2 })
    const callback = vi.fn()
    vad.onSpeech(callback)

    // Feed enough speech chunks
    vad.feed(makeSpeechChunk())
    vad.feed(makeSpeechChunk())
    vad.feed(makeSpeechChunk())

    // Feed silence to trigger the timer
    vad.feed(makeSilenceChunk())

    // Advance past the silence threshold
    vi.advanceTimersByTime(1100)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(expect.any(Array))
    // Should have received 3 speech chunks
    expect(callback.mock.calls[0][0]).toHaveLength(3)

    vad.destroy()
  })

  it('should not fire callback if fewer chunks than minChunks', () => {
    const vad = new VoiceActivityDetector({ silenceThresholdMs: 500, minChunks: 5 })
    const callback = vi.fn()
    vad.onSpeech(callback)

    // Only feed 2 speech chunks (below minChunks=5)
    vad.feed(makeSpeechChunk())
    vad.feed(makeSpeechChunk())

    // Silence + wait
    vad.feed(makeSilenceChunk())
    vi.advanceTimersByTime(600)

    expect(callback).not.toHaveBeenCalled()
    vad.destroy()
  })

  it('should reset silence timer when more speech arrives', () => {
    const vad = new VoiceActivityDetector({ silenceThresholdMs: 1000, minChunks: 2 })
    const callback = vi.fn()
    vad.onSpeech(callback)

    vad.feed(makeSpeechChunk())
    vad.feed(makeSpeechChunk())

    // Start silence
    vad.feed(makeSilenceChunk())
    vi.advanceTimersByTime(500)

    // More speech resets the timer
    vad.feed(makeSpeechChunk())

    // Advance past original threshold — should NOT fire
    vi.advanceTimersByTime(600)
    expect(callback).not.toHaveBeenCalled()

    // Now silence again
    vad.feed(makeSilenceChunk())
    vi.advanceTimersByTime(1100)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0]).toHaveLength(3) // 3 speech chunks total
    vad.destroy()
  })

  it('should reset state without firing callback', () => {
    const vad = new VoiceActivityDetector({ silenceThresholdMs: 500, minChunks: 1 })
    const callback = vi.fn()
    vad.onSpeech(callback)

    vad.feed(makeSpeechChunk())
    vad.feed(makeSpeechChunk())

    vad.reset()

    // Silence after reset
    vad.feed(makeSilenceChunk())
    vi.advanceTimersByTime(600)

    expect(callback).not.toHaveBeenCalled()
    vad.destroy()
  })

  it('should clean up on destroy', () => {
    const vad = new VoiceActivityDetector({ silenceThresholdMs: 500, minChunks: 1 })
    const callback = vi.fn()
    vad.onSpeech(callback)

    vad.feed(makeSpeechChunk())
    vad.destroy()

    // Feed silence after destroy — nothing should happen
    vad.feed(makeSilenceChunk())
    vi.advanceTimersByTime(600)

    expect(callback).not.toHaveBeenCalled()
  })

  it('should not start silence timer without prior speech', () => {
    const vad = new VoiceActivityDetector({ silenceThresholdMs: 500, minChunks: 1 })
    const callback = vi.fn()
    vad.onSpeech(callback)

    // Feed only silence — no speech accumulated, no timer
    vad.feed(makeSilenceChunk())
    vad.feed(makeSilenceChunk())
    vi.advanceTimersByTime(1000)

    expect(callback).not.toHaveBeenCalled()
    vad.destroy()
  })
})


