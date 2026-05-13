// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

/**
 * AudioWorklet processor code for injecting TTS audio into the outbound stream.
 *
 * Replaces the oscillator+BufferSource approach with a queue-based worklet
 * that provides smooth, gapless playback and accurate timing information.
 */

export const injectionWorkletCode = `
class InjectionProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.currentBuffer = null;
    this.currentIndex = 0;
    this.totalSamplesPlayed = 0;
    this.playing = false;

    this.port.onmessage = (event) => {
      if (event.data.type === 'enqueue') {
        this.queue.push(new Float32Array(event.data.buffer));
        if (!this.playing) {
          this.playing = true;
          this.port.postMessage({ type: 'playback-started' });
        }
      } else if (event.data.type === 'clear') {
        this.queue = [];
        this.currentBuffer = null;
        this.currentIndex = 0;
        if (this.playing) {
          this.playing = false;
          this.port.postMessage({
            type: 'playback-ended',
            totalSamples: this.totalSamplesPlayed,
          });
          this.totalSamplesPlayed = 0;
        }
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0][0];
    if (!output) return true;

    for (let i = 0; i < output.length; i++) {
      if (!this.currentBuffer || this.currentIndex >= this.currentBuffer.length) {
        this.currentBuffer = this.queue.shift() || null;
        this.currentIndex = 0;

        // Check if playback just finished
        if (!this.currentBuffer && this.playing) {
          this.playing = false;
          this.port.postMessage({
            type: 'playback-ended',
            totalSamples: this.totalSamplesPlayed,
          });
          this.totalSamplesPlayed = 0;
        }
      }

      if (this.currentBuffer) {
        output[i] = this.currentBuffer[this.currentIndex++];
        this.totalSamplesPlayed++;
      } else {
        output[i] = 0; // Silence when no audio queued
      }
    }

    // Notify main thread when queue is running low
    if (this.playing && this.queue.length < 2) {
      this.port.postMessage({ type: 'queue-low', remaining: this.queue.length });
    }

    return true;
  }
}

registerProcessor('injection-processor', InjectionProcessor);
`;


