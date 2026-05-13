// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

import { describe, it, expect } from 'vitest'
import { captureWorkletCode } from '../../../src/audio/worklets/capture'
import { injectionWorkletCode } from '../../../src/audio/worklets/injection'

describe('AudioWorklet code strings', () => {
  describe('captureWorkletCode', () => {
    it('should be a non-empty string', () => {
      expect(typeof captureWorkletCode).toBe('string')
      expect(captureWorkletCode.length).toBeGreaterThan(100)
    })

    it('should register CaptureProcessor', () => {
      expect(captureWorkletCode).toContain('class CaptureProcessor extends AudioWorkletProcessor')
      expect(captureWorkletCode).toContain("registerProcessor('capture-processor', CaptureProcessor)")
    })

    it('should implement process method', () => {
      expect(captureWorkletCode).toContain('process(inputs, outputs, parameters)')
    })

    it('should post audio-data messages', () => {
      expect(captureWorkletCode).toContain("type: 'audio-data'")
    })

    it('should compute RMS and peak for silence detection', () => {
      expect(captureWorkletCode).toContain('peak')
      expect(captureWorkletCode).toContain('rms')
    })

    it('should support enable/disable via messages', () => {
      expect(captureWorkletCode).toContain("'set-enabled'")
      expect(captureWorkletCode).toContain('this.enabled')
    })
  })

  describe('injectionWorkletCode', () => {
    it('should be a non-empty string', () => {
      expect(typeof injectionWorkletCode).toBe('string')
      expect(injectionWorkletCode.length).toBeGreaterThan(100)
    })

    it('should register InjectionProcessor', () => {
      expect(injectionWorkletCode).toContain('class InjectionProcessor extends AudioWorkletProcessor')
      expect(injectionWorkletCode).toContain("registerProcessor('injection-processor', InjectionProcessor)")
    })

    it('should implement process method', () => {
      expect(injectionWorkletCode).toContain('process(inputs, outputs)')
    })

    it('should support enqueue and clear messages', () => {
      expect(injectionWorkletCode).toContain("'enqueue'")
      expect(injectionWorkletCode).toContain("'clear'")
    })

    it('should emit playback lifecycle events', () => {
      expect(injectionWorkletCode).toContain("type: 'playback-started'")
      expect(injectionWorkletCode).toContain("type: 'playback-ended'")
    })

    it('should emit queue-low notification', () => {
      expect(injectionWorkletCode).toContain("type: 'queue-low'")
    })

    it('should output silence when queue is empty', () => {
      expect(injectionWorkletCode).toContain('output[i] = 0')
    })
  })
})


