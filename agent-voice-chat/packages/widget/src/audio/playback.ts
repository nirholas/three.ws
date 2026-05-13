// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

/**
 * Audio playback queue — plays base64-encoded audio chunks
 * sequentially, with support for browser TTS fallback.
 */
export class AudioPlayback {
  private audioContext: AudioContext | null = null;
  private queue: Array<{ audio: string; format: string }> = [];
  private isPlaying = false;
  private currentSource: AudioBufferSourceNode | null = null;
  private speechSynth: SpeechSynthesis | null = null;

  /** Called when playback starts */
  onPlayStart?: () => void;
  /** Called when all queued audio finishes */
  onPlayEnd?: () => void;

  constructor() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      this.speechSynth = window.speechSynthesis;
    }
  }

  private getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    return this.audioContext;
  }

  /** Enqueue base64 audio for playback */
  enqueue(audio: string, format: string = 'audio/mp3'): void {
    this.queue.push({ audio, format });
    if (!this.isPlaying) {
      this.playNext();
    }
  }

  /** Play text using browser speech synthesis (fallback) */
  speakText(text: string): void {
    if (!this.speechSynth) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onstart = () => this.onPlayStart?.();
    utterance.onend = () => this.onPlayEnd?.();
    utterance.onerror = () => this.onPlayEnd?.();
    this.speechSynth.speak(utterance);
  }

  /** Stop all playback and clear queue */
  stop(): void {
    this.queue = [];
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch {}
      this.currentSource = null;
    }
    if (this.speechSynth) {
      this.speechSynth.cancel();
    }
    this.isPlaying = false;
  }

  /** Clean up */
  destroy(): void {
    this.stop();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  private async playNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.isPlaying = false;
      this.onPlayEnd?.();
      return;
    }

    this.isPlaying = true;
    if (this.queue.length === 1 || !this.isPlaying) {
      this.onPlayStart?.();
    }

    const { audio } = this.queue.shift()!;

    try {
      const ctx = this.getContext();
      // Resume context if suspended (autoplay policy)
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const binaryStr = atob(audio);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      this.currentSource = source;

      source.onended = () => {
        this.currentSource = null;
        this.playNext();
      };

      source.start(0);
    } catch {
      // If decoding fails, skip and play next
      this.currentSource = null;
      this.playNext();
    }
  }
}
