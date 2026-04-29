// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§87]

export class AudioPlayer {
  private audioContext: AudioContext | null = null
  private queue: ArrayBuffer[] = []
  private playing = false

  async play(base64Audio: string, format: string): Promise<void> {
    const buffer = this.base64ToArrayBuffer(base64Audio)
    this.queue.push(buffer)
    if (!this.playing) {
      await this.processQueue(format)
    }
  }

  stop(): void {
    this.queue = []
    this.playing = false
  }

  destroy(): void {
    this.stop()
    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }
  }

  private async processQueue(_format: string): Promise<void> {
    this.playing = true
    const ctx = this.getContext()

    while (this.queue.length > 0) {
      const buffer = this.queue.shift()!
      try {
        const audioBuffer = await ctx.decodeAudioData(buffer.slice(0))
        await this.playBuffer(ctx, audioBuffer)
      } catch {
        // skip undecodable audio chunks
      }
    }
    this.playing = false
  }

  private playBuffer(ctx: AudioContext, buffer: AudioBuffer): Promise<void> {
    return new Promise((resolve) => {
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(ctx.destination)
      source.onended = () => resolve()
      source.start(0)
    })
  }

  private getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext()
    }
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume()
    }
    return this.audioContext
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
  }
}


