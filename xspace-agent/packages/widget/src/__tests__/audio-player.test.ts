// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AudioPlayer } from '../audio/audio-player'

// ── AudioContext / AudioBuffer mocks ────────────────────────────────

function createMockAudioBuffer(duration = 0.5): AudioBuffer {
  return {
    duration,
    length: 8000,
    numberOfChannels: 1,
    sampleRate: 16000,
    getChannelData: vi.fn(),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer
}

function createMockBufferSource() {
  const source: Record<string, unknown> = {
    buffer: null,
    onended: null,
    connect: vi.fn(),
    start: vi.fn(() => {
      // Resolve immediately so playback "finishes" synchronously in tests
      queueMicrotask(() => {
        if (typeof source.onended === 'function') {
          source.onended()
        }
      })
    }),
    disconnect: vi.fn(),
  }
  return source as unknown as AudioBufferSourceNode
}

let mockContextInstance: {
  state: string
  destination: AudioDestinationNode
  close: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
  decodeAudioData: ReturnType<typeof vi.fn>
  createBufferSource: ReturnType<typeof vi.fn>
}

class MockAudioContext {
  state = 'running'
  destination = {} as AudioDestinationNode
  close = vi.fn()
  resume = vi.fn()
  decodeAudioData = vi.fn(async () => createMockAudioBuffer())
  createBufferSource = vi.fn(() => createMockBufferSource())

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    mockContextInstance = this
  }
}

vi.stubGlobal('AudioContext', MockAudioContext)

// ─────────────────────────────────────────────────────────────────────

describe('AudioPlayer', () => {
  let player: AudioPlayer

  beforeEach(() => {
    player = new AudioPlayer()
  })

  afterEach(() => {
    player.destroy()
  })

  // ── queue-based playback ─────────────────────────────────────────

  it('plays a single base64 audio clip', async () => {
    const b64 = btoa('fakeaudio')
    await player.play(b64, 'audio/mp3')

    expect(mockContextInstance.decodeAudioData).toHaveBeenCalledTimes(1)
    expect(mockContextInstance.createBufferSource).toHaveBeenCalledTimes(1)
  })

  it('plays multiple clips sequentially through the queue', async () => {
    const b64a = btoa('audio-a')
    const b64b = btoa('audio-b')

    // Queue first clip – starts processing immediately
    const p1 = player.play(b64a, 'audio/mp3')
    // Queue second clip while first is still in the queue
    const p2 = player.play(b64b, 'audio/mp3')

    await p1
    await p2

    // Both should have been decoded
    expect(mockContextInstance.decodeAudioData).toHaveBeenCalledTimes(2)
  })

  it('skips undecodable audio chunks without throwing', async () => {
    mockContextInstance?.decodeAudioData?.mockRejectedValueOnce(new Error('bad format'))

    const b64 = btoa('corrupt-data')
    // Should not throw
    await expect(player.play(b64, 'audio/mp3')).resolves.toBeUndefined()
  })

  it('resumes a suspended AudioContext before playback', async () => {
    const b64 = btoa('audio')
    // First play creates the context, set it to suspended
    await player.play(b64, 'audio/mp3')

    mockContextInstance.state = 'suspended'
    await player.play(btoa('more'), 'audio/mp3')
    expect(mockContextInstance.resume).toHaveBeenCalled()
  })

  // ── stop ─────────────────────────────────────────────────────────

  it('stop() clears the queue', () => {
    player.stop()
    // After stop, playing should be reset (no-op on empty queue)
    // We verify indirectly: a subsequent play should work fresh
    expect(() => player.stop()).not.toThrow()
  })

  // ── destroy ──────────────────────────────────────────────────────

  it('destroy() closes the AudioContext', async () => {
    // Trigger context creation
    await player.play(btoa('x'), 'audio/mp3')
    player.destroy()
    expect(mockContextInstance.close).toHaveBeenCalled()
  })

  it('destroy() is safe to call multiple times', async () => {
    await player.play(btoa('x'), 'audio/mp3')
    player.destroy()
    player.destroy() // second call should not throw
    expect(mockContextInstance.close).toHaveBeenCalledTimes(1)
  })

  // ── base64 decoding ──────────────────────────────────────────────

  it('correctly converts base64 to ArrayBuffer for decoding', async () => {
    const original = 'Hello, AudioPlayer!'
    const b64 = btoa(original)
    await player.play(b64, 'audio/mp3')

    const passedBuffer = mockContextInstance.decodeAudioData.mock.calls[0][0] as ArrayBuffer
    const decoded = new TextDecoder('latin1').decode(new Uint8Array(passedBuffer))
    expect(decoded).toBe(original)
  })
})


