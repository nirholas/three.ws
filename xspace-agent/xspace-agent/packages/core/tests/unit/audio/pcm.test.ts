// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

import { describe, it, expect } from 'vitest'
import { pcmChunksToWav } from '../../../src/audio/bridge'

describe('pcmChunksToWav', () => {
  it('should produce a valid WAV header', () => {
    // Create a PCM Float32 chunk (silence)
    const float32 = new Float32Array(1024).fill(0)
    const chunk = Buffer.from(float32.buffer)

    const wav = pcmChunksToWav([chunk], 16000)

    // WAV header checks
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ')
    expect(wav.toString('ascii', 36, 40)).toBe('data')

    // Format: PCM (1)
    expect(wav.readUInt16LE(20)).toBe(1)
    // Channels: 1 (mono)
    expect(wav.readUInt16LE(22)).toBe(1)
    // Sample rate: 16000
    expect(wav.readUInt32LE(24)).toBe(16000)
    // Bits per sample: 16
    expect(wav.readUInt16LE(34)).toBe(16)
  })

  it('should convert Float32 samples to Int16', () => {
    // A single sample of 1.0 should map to 0x7FFF (32767)
    const float32 = new Float32Array([1.0])
    const chunk = Buffer.from(float32.buffer)

    const wav = pcmChunksToWav([chunk], 16000)

    // Data starts at offset 44
    const sample = wav.readInt16LE(44)
    expect(sample).toBe(32767)
  })

  it('should handle negative samples', () => {
    // A sample of -1.0 should map to -32768
    const float32 = new Float32Array([-1.0])
    const chunk = Buffer.from(float32.buffer)

    const wav = pcmChunksToWav([chunk], 16000)
    const sample = wav.readInt16LE(44)
    expect(sample).toBe(-32768)
  })

  it('should concatenate multiple chunks', () => {
    const chunk1 = Buffer.from(new Float32Array([0.5, -0.5]).buffer)
    const chunk2 = Buffer.from(new Float32Array([0.25, -0.25]).buffer)

    const wav = pcmChunksToWav([chunk1, chunk2], 16000)

    // Data size should be 4 samples * 2 bytes = 8
    const dataSize = wav.readUInt32LE(40)
    expect(dataSize).toBe(8)

    // Total WAV size = 44 header + 8 data
    expect(wav.length).toBe(52)
  })

  it('should clamp values beyond [-1, 1]', () => {
    const float32 = new Float32Array([2.0, -3.0])
    const chunk = Buffer.from(float32.buffer)

    const wav = pcmChunksToWav([chunk], 16000)

    // Values should be clamped
    const sample1 = wav.readInt16LE(44)
    const sample2 = wav.readInt16LE(46)
    expect(sample1).toBe(32767)  // clamped to 1.0
    expect(sample2).toBe(-32768) // clamped to -1.0
  })

  it('should respect custom sample rate', () => {
    const float32 = new Float32Array([0])
    const chunk = Buffer.from(float32.buffer)

    const wav = pcmChunksToWav([chunk], 44100)
    expect(wav.readUInt32LE(24)).toBe(44100)
  })

  it('should handle empty chunks array', () => {
    const wav = pcmChunksToWav([], 16000)

    // Should still have a valid header
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(40)).toBe(0) // data size = 0
    expect(wav.length).toBe(44) // header only
  })
})


