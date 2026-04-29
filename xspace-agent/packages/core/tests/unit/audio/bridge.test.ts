// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

import { describe, it, expect } from 'vitest'
import { pcmChunksToWav } from '../../../src/audio/bridge'

describe('pcmChunksToWav', () => {
  // ---------------------------------------------------------------------------
  // WAV header structure
  // ---------------------------------------------------------------------------

  it('should produce a valid WAV header with RIFF/WAVE markers', () => {
    const float32 = new Float32Array([0.0, 0.5, -0.5, 1.0])
    const pcmChunk = Buffer.from(float32.buffer)
    const wav = pcmChunksToWav([pcmChunk])

    // Check RIFF header
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.toString('ascii', 12, 16)).toBe('fmt ')
    expect(wav.toString('ascii', 36, 40)).toBe('data')
  })

  it('should set correct WAV format fields (PCM, mono, 16-bit)', () => {
    const float32 = new Float32Array([0.0])
    const pcmChunk = Buffer.from(float32.buffer)
    const wav = pcmChunksToWav([pcmChunk])

    // fmt chunk size = 16
    expect(wav.readUInt32LE(16)).toBe(16)
    // Audio format = 1 (PCM)
    expect(wav.readUInt16LE(20)).toBe(1)
    // Channels = 1 (mono)
    expect(wav.readUInt16LE(22)).toBe(1)
    // Bits per sample = 16
    expect(wav.readUInt16LE(34)).toBe(16)
  })

  it('should use default sample rate of 16000', () => {
    const float32 = new Float32Array([0.0])
    const pcmChunk = Buffer.from(float32.buffer)
    const wav = pcmChunksToWav([pcmChunk])

    expect(wav.readUInt32LE(24)).toBe(16000) // Sample rate
    expect(wav.readUInt32LE(28)).toBe(32000) // Byte rate = sampleRate * 2
    expect(wav.readUInt16LE(32)).toBe(2) // Block align = channels * bitsPerSample/8
  })

  it('should use custom sample rate', () => {
    const float32 = new Float32Array([0.0])
    const pcmChunk = Buffer.from(float32.buffer)
    const wav = pcmChunksToWav([pcmChunk], 48000)

    expect(wav.readUInt32LE(24)).toBe(48000)
    expect(wav.readUInt32LE(28)).toBe(96000)
  })

  // ---------------------------------------------------------------------------
  // PCM data conversion (Float32 -> Int16)
  // ---------------------------------------------------------------------------

  it('should convert Float32 samples to Int16 correctly', () => {
    const float32 = new Float32Array([0.0, 1.0, -1.0])
    const pcmChunk = Buffer.from(float32.buffer)
    const wav = pcmChunksToWav([pcmChunk])

    // Data starts at byte 44 (after header)
    const sample0 = wav.readInt16LE(44)
    const sample1 = wav.readInt16LE(46)
    const sample2 = wav.readInt16LE(48)

    expect(sample0).toBe(0) // 0.0 -> 0
    expect(sample1).toBe(0x7fff) // 1.0 -> 32767
    expect(sample2).toBe(-0x8000) // -1.0 -> -32768
  })

  it('should clamp values outside [-1, 1]', () => {
    const float32 = new Float32Array([2.0, -2.0])
    const pcmChunk = Buffer.from(float32.buffer)
    const wav = pcmChunksToWav([pcmChunk])

    const sample0 = wav.readInt16LE(44)
    const sample1 = wav.readInt16LE(46)

    // Clamped to max/min
    expect(sample0).toBe(0x7fff)
    expect(sample1).toBe(-0x8000)
  })

  // ---------------------------------------------------------------------------
  // Multiple chunks
  // ---------------------------------------------------------------------------

  it('should concatenate multiple PCM chunks into a single WAV', () => {
    const chunk1 = Buffer.from(new Float32Array([0.5, -0.5]).buffer)
    const chunk2 = Buffer.from(new Float32Array([0.25, -0.25]).buffer)
    const wav = pcmChunksToWav([chunk1, chunk2])

    // Total data size: 4 samples * 2 bytes each = 8 bytes
    const dataSize = wav.readUInt32LE(40)
    expect(dataSize).toBe(8)

    // RIFF size = 36 + dataSize
    const riffSize = wav.readUInt32LE(4)
    expect(riffSize).toBe(36 + 8)

    // Total WAV size = 44 header + 8 data
    expect(wav.length).toBe(52)
  })

  it('should handle empty chunks array', () => {
    const wav = pcmChunksToWav([])

    // Should produce a valid header with 0-byte data section
    expect(wav.length).toBe(44)
    expect(wav.readUInt32LE(40)).toBe(0) // data size
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
  })

  it('should handle a single sample', () => {
    const float32 = new Float32Array([0.5])
    const pcmChunk = Buffer.from(float32.buffer)
    const wav = pcmChunksToWav([pcmChunk])

    expect(wav.length).toBe(46) // 44 header + 2 bytes for one int16 sample
    const sample = wav.readInt16LE(44)
    // 0.5 * 0x7fff = ~16383
    expect(sample).toBeCloseTo(0.5 * 0x7fff, -1)
  })

  // ---------------------------------------------------------------------------
  // Fractional values
  // ---------------------------------------------------------------------------

  it('should correctly scale mid-range Float32 values', () => {
    const float32 = new Float32Array([0.5])
    const pcmChunk = Buffer.from(float32.buffer)
    const wav = pcmChunksToWav([pcmChunk])

    const sample = wav.readInt16LE(44)
    // The conversion uses s * 0x7fff for positive values: 0.5 * 32767 = 16383.5
    // Int16LE write truncates, so the result is 16383
    expect(sample).toBe(16383)
  })

  it('should handle negative fractional values', () => {
    const float32 = new Float32Array([-0.5])
    const pcmChunk = Buffer.from(float32.buffer)
    const wav = pcmChunksToWav([pcmChunk])

    const sample = wav.readInt16LE(44)
    // Expected: -0.5 * 32768 = -16384
    expect(sample).toBe(Math.round(-0.5 * 0x8000))
  })
})


