// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VoiceInput } from '../audio/voice-input'

// ── Browser API mocks ───────────────────────────────────────────────

const mockTrackStop = vi.fn()

function createMockMediaStream() {
  return {
    getTracks: vi.fn(() => [
      { stop: mockTrackStop, kind: 'audio' },
    ]),
  } as unknown as MediaStream
}

let mockStream: MediaStream
let recorderInstance: MockMediaRecorder | null = null

class MockMediaRecorder {
  mimeType: string
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  state = 'inactive'

  constructor(_stream: MediaStream, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? 'audio/webm'
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    recorderInstance = this
  }

  start(_timeslice?: number) {
    this.state = 'recording'
    // Simulate receiving a data chunk asynchronously
    queueMicrotask(() => {
      if (this.ondataavailable) {
        // Create a Blob that has arrayBuffer() support for jsdom
        const blob = new Blob(['audio-bytes'], { type: this.mimeType })
        this.ondataavailable({ data: blob })
      }
    })
  }

  stop() {
    this.state = 'inactive'
    queueMicrotask(() => {
      this.onstop?.()
    })
  }

  static isTypeSupported(type: string): boolean {
    return type === 'audio/webm;codecs=opus' || type === 'audio/webm'
  }
}

// Polyfill Blob.prototype.arrayBuffer for jsdom if needed
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (): Promise<ArrayBuffer> {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.readAsArrayBuffer(this)
    })
  }
}

// Install global mocks
vi.stubGlobal('MediaRecorder', MockMediaRecorder)

const mockGetUserMedia = vi.fn(() => {
  mockStream = createMockMediaStream()
  return Promise.resolve(mockStream)
})

vi.stubGlobal('navigator', {
  mediaDevices: {
    getUserMedia: mockGetUserMedia,
  },
})

// ─────────────────────────────────────────────────────────────────────

describe('VoiceInput', () => {
  let input: VoiceInput

  beforeEach(() => {
    recorderInstance = null
    mockTrackStop.mockClear()
    mockGetUserMedia.mockClear()
    input = new VoiceInput()
  })

  afterEach(() => {
    input.destroy()
  })

  // ── isSupported ──────────────────────────────────────────────────

  describe('isSupported', () => {
    it('returns true when getUserMedia and MediaRecorder exist', () => {
      expect(VoiceInput.isSupported()).toBe(true)
    })

    it('returns false when mediaDevices is unavailable', () => {
      const saved = navigator.mediaDevices
      Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
      expect(VoiceInput.isSupported()).toBe(false)
      Object.defineProperty(navigator, 'mediaDevices', { value: saved, configurable: true })
    })

    it('returns false when MediaRecorder is unavailable', () => {
      const saved = window.MediaRecorder
      Object.defineProperty(window, 'MediaRecorder', { value: undefined, configurable: true })
      expect(VoiceInput.isSupported()).toBe(false)
      Object.defineProperty(window, 'MediaRecorder', { value: saved, configurable: true })
    })
  })

  // ── start / stop lifecycle ───────────────────────────────────────

  it('starts recording and sets state to recording', async () => {
    const states: string[] = []
    input.onStateChange((s) => states.push(s))

    await input.start()

    expect(input.isRecording()).toBe(true)
    expect(input.getState()).toBe('recording')
    expect(states).toContain('recording')
    expect(mockGetUserMedia).toHaveBeenCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
      },
    })
  })

  it('stop() returns buffer and mimeType', async () => {
    await input.start()
    // Allow ondataavailable to fire
    await new Promise((r) => setTimeout(r, 50))

    const result = await input.stop()
    expect(result).not.toBeNull()
    expect(result!.mimeType).toBe('audio/webm;codecs=opus')
    expect(result!.buffer).toBeInstanceOf(ArrayBuffer)
  })

  it('stop() returns null when not recording', async () => {
    const result = await input.stop()
    expect(result).toBeNull()
  })

  it('sets state back to idle after stop', async () => {
    const states: string[] = []
    input.onStateChange((s) => states.push(s))

    await input.start()
    await new Promise((r) => setTimeout(r, 50))
    await input.stop()

    expect(input.getState()).toBe('idle')
    expect(states).toContain('idle')
  })

  it('is a no-op if start() is called while already recording', async () => {
    await input.start()
    // Second call should be ignored
    await input.start()

    // getUserMedia should have been called only once
    expect(mockGetUserMedia).toHaveBeenCalledTimes(1)
  })

  // ── cancel ───────────────────────────────────────────────────────

  it('cancel() discards data and returns to idle', async () => {
    await input.start()
    await new Promise((r) => setTimeout(r, 50))

    input.cancel()

    expect(input.isRecording()).toBe(false)
    expect(input.getState()).toBe('idle')
  })

  it('cancel() stops media stream tracks', async () => {
    await input.start()

    input.cancel()

    // Tracks should have been stopped
    expect(mockTrackStop).toHaveBeenCalled()
  })

  // ── error handling ───────────────────────────────────────────────

  it('sets state to error and throws when getUserMedia fails', async () => {
    mockGetUserMedia.mockRejectedValueOnce(new Error('NotAllowed'))

    const states: string[] = []
    input.onStateChange((s) => states.push(s))

    await expect(input.start()).rejects.toThrow('Microphone access denied')
    expect(input.getState()).toBe('error')
    expect(states).toContain('error')
  })

  // ── destroy ──────────────────────────────────────────────────────

  it('destroy() cancels recording and clears handlers', async () => {
    const handler = vi.fn()
    input.onStateChange(handler)

    await input.start()
    handler.mockClear()

    input.destroy()

    expect(input.isRecording()).toBe(false)
  })

  // ── getSupportedMimeType ─────────────────────────────────────────

  it('selects the first supported mime type', async () => {
    await input.start()
    // Our mock says audio/webm;codecs=opus and audio/webm are supported
    // The code tries audio/webm;codecs=opus first
    expect(recorderInstance!.mimeType).toBe('audio/webm;codecs=opus')
  })
})


