// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

/**
 * AudioWorklet processor code for capturing incoming audio.
 *
 * This code is stringified and injected into the browser page context via
 * AudioWorklet.addModule(). It runs on the audio rendering thread, avoiding
 * the main-thread blocking issues of the deprecated ScriptProcessorNode.
 */

export const captureWorkletCode = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
    this.enabled = true;

    this.port.onmessage = (event) => {
      if (event.data.type === 'set-enabled') {
        this.enabled = event.data.enabled;
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (!this.enabled) return true;

    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0]; // Mono

    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.bufferIndex++] = channelData[i];

      if (this.bufferIndex >= this.bufferSize) {
        // Compute RMS and peak for quick silence detection on audio thread
        let sumSq = 0;
        let peak = 0;
        for (let j = 0; j < this.bufferSize; j++) {
          const v = this.buffer[j];
          sumSq += v * v;
          const abs = v < 0 ? -v : v;
          if (abs > peak) peak = abs;
        }
        const rms = Math.sqrt(sumSq / this.bufferSize);

        // Only send non-silent frames (peak > 0.001)
        if (peak > 0.001) {
          this.port.postMessage({
            type: 'audio-data',
            buffer: this.buffer.slice(),
            sampleRate: sampleRate,
            rms: rms,
            peak: peak,
          });
        }

        this.bufferIndex = 0;
      }
    }

    return true; // Keep processor alive
  }
}

registerProcessor('capture-processor', CaptureProcessor);
`;


