// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§76]

/**
 * Generate test fixture WAV files.
 * Run with: npx tsx src/__tests__/fixtures/generate-fixtures.ts
 */
import fs from 'fs'
import path from 'path'

function createWavBuffer(
  samples: Float32Array,
  sampleRate: number = 16000,
): Buffer {
  const int16 = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    int16.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, i * 2)
  }

  const dataSize = int16.length
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)    // PCM chunk size
  header.writeUInt16LE(1, 20)     // PCM format
  header.writeUInt16LE(1, 22)     // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28) // byte rate
  header.writeUInt16LE(2, 32)     // block align
  header.writeUInt16LE(16, 34)    // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)

  return Buffer.concat([header, int16])
}

const SAMPLE_RATE = 16000
const DURATION = 2 // seconds
const NUM_SAMPLES = SAMPLE_RATE * DURATION

// hello.wav — a synthetic tone burst that mimics speech energy
// Uses a 200Hz fundamental with harmonics and amplitude envelope
const helloSamples = new Float32Array(NUM_SAMPLES)
for (let i = 0; i < NUM_SAMPLES; i++) {
  const t = i / SAMPLE_RATE
  // Amplitude envelope: ramp up, sustain, ramp down
  let envelope = 0
  if (t < 0.1) envelope = t / 0.1
  else if (t < 0.6) envelope = 1.0
  else if (t < 0.8) envelope = 1.0 - (t - 0.6) / 0.2
  else if (t < 1.0) envelope = 0.0
  else if (t < 1.1) envelope = (t - 1.0) / 0.1
  else if (t < 1.6) envelope = 1.0
  else if (t < 1.8) envelope = 1.0 - (t - 1.6) / 0.2
  else envelope = 0.0

  // Mix of fundamental + harmonics for speech-like spectrum
  const signal =
    0.5 * Math.sin(2 * Math.PI * 200 * t) +
    0.3 * Math.sin(2 * Math.PI * 400 * t) +
    0.15 * Math.sin(2 * Math.PI * 800 * t) +
    0.05 * Math.sin(2 * Math.PI * 1200 * t)

  helloSamples[i] = signal * envelope * 0.8
}

// silence.wav — 2 seconds of silence
const silenceSamples = new Float32Array(NUM_SAMPLES)

const dir = path.dirname(new URL(import.meta.url).pathname)
fs.writeFileSync(path.join(dir, 'hello.wav'), createWavBuffer(helloSamples, SAMPLE_RATE))
fs.writeFileSync(path.join(dir, 'silence.wav'), createWavBuffer(silenceSamples, SAMPLE_RATE))

console.log('Generated hello.wav and silence.wav in', dir)


