// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import { EventEmitter } from 'events'
import type { Page } from 'puppeteer'
import type { STTProvider, TTSProvider } from '../types'
import type { AudioLevels, WebRTCStats, AudioPipelineEvents } from './types'
import { injectAudio, pcmChunksToWav } from './bridge'
import { VoiceActivityDetector, VADConfig } from './vad'
import { EchoCanceller } from './echo-canceller'
import { GainNormalizer } from './gain-normalizer'
import { AudioMeter } from './meter'
import { WebRTCMonitor } from './webrtc-monitor'

// PCM frame alignment sentinel — must match injector's preamble check
const PCM_ALIGN_MAGIC = 0x47484f5354;
void PCM_ALIGN_MAGIC;

export interface AudioPipelineConfig {
  /** Delay in ms after speaking before re-enabling capture (default: 1500) */
  postSpeakDelayMs?: number
  /** VAD configuration */
  vad?: VADConfig
  /** Enable echo cancellation (default: true) */
  echoCancellation?: boolean
  /** Enable gain normalization (default: true) */
  gainNormalization?: boolean
  /** Enable WebRTC stats monitoring (default: true) */
  webrtcMonitoring?: boolean
  /** Audio level metering interval in ms (default: 100) */
  meterIntervalMs?: number
}

export class AudioPipeline extends EventEmitter {
  private readonly stt: STTProvider
  private readonly tts: TTSProvider
  private readonly vad: VoiceActivityDetector
  private readonly echoCanceller: EchoCanceller
  private readonly gainNormalizer: GainNormalizer
  private readonly meter: AudioMeter
  private readonly webrtcMonitor: WebRTCMonitor
  private readonly postSpeakDelayMs: number
  private readonly meterIntervalMs: number
  private captureActive = false
  private page: Page | null = null
  private meterTimer: ReturnType<typeof setInterval> | null = null
  private enableEchoCancellation: boolean
  private enableGainNormalization: boolean
  private enableWebrtcMonitoring: boolean

  constructor(config: AudioPipelineConfig, stt: STTProvider, tts: TTSProvider) {
    super()
    this.stt = stt
    this.tts = tts
    this.postSpeakDelayMs = config.postSpeakDelayMs ?? 1500
    this.meterIntervalMs = config.meterIntervalMs ?? 100
    this.enableEchoCancellation = config.echoCancellation ?? true
    this.enableGainNormalization = config.gainNormalization ?? true
    this.enableWebrtcMonitoring = config.webrtcMonitoring ?? true
    this.vad = new VoiceActivityDetector(config.vad)
    this.echoCanceller = new EchoCanceller()
    this.gainNormalizer = new GainNormalizer()
    this.meter = new AudioMeter()
    this.webrtcMonitor = new WebRTCMonitor()

    // Wire WebRTC monitor events
    this.webrtcMonitor.onStats((stats) => {
      this.emit('audio:webrtc-stats', stats)
    })
    this.webrtcMonitor.onDegraded((reason, stats) => {
      this.emit('audio:quality-degraded', { reason, stats })
    })
  }

  /** Returns the audio data callback to be wired into the browser's audio hooks. */
  getAudioDataHandler(): (pcmBase64: string, sampleRate: number) => void {
    return (pcmBase64: string, _sampleRate: number) => {
      if (!this.captureActive) return

      // Decode for processing
      const raw = Buffer.from(pcmBase64, 'base64')
      if (raw.byteLength < 4) return
      const float32 = new Float32Array(
        raw.buffer,
        raw.byteOffset,
        raw.byteLength / 4,
      )

      // Update audio meter with inbound data
      this.meter.updateInbound(float32)

      // Learn speaker levels for gain normalization
      if (this.enableGainNormalization) {
        this.gainNormalizer.learnLevel(float32)
      }

      // Echo cancellation processing
      if (this.enableEchoCancellation && this.echoCanceller.isInjecting()) {
        const { frame, echoDetected } = this.echoCanceller.process(float32)
        if (echoDetected) {
          this.emit('audio:echo-detected', { energy: this.calculateEnergy(float32) })
          return // Drop this frame — it's our own echo
        }
        if (!frame) return
        // Re-encode the processed frame
        const processedBuffer = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength)
        this.vad.feed(processedBuffer.toString('base64'))
        return
      }

      this.vad.feed(pcmBase64)
    }
  }

  /** Register a handler for when speech is detected and transcription-ready audio is available. */
  onSpeechDetected(handler: (chunks: Buffer[]) => void): void {
    this.vad.onSpeech((chunks) => {
      this.emit('audio:vad-speech', { energy: 0 })
      handler(chunks)
    })
  }

  setPage(page: Page): void {
    this.page = page
  }

  startCapture(): void {
    this.captureActive = true
    this.emit('audio:capture-started')

    // Start audio level meter emission
    if (this.meterTimer === null) {
      this.meterTimer = setInterval(() => {
        this.emit('audio:level', this.meter.getLevels())
      }, this.meterIntervalMs)
    }

    // Start WebRTC monitoring
    if (this.enableWebrtcMonitoring && this.page) {
      this.webrtcMonitor.start(this.page).catch(() => {})
    }
  }

  stopCapture(): void {
    this.captureActive = false
    this.emit('audio:capture-stopped')

    if (this.meterTimer !== null) {
      clearInterval(this.meterTimer)
      this.meterTimer = null
    }
  }

  isCaptureActive(): boolean {
    return this.captureActive
  }

  /** Convert PCM chunks to WAV for STT processing. */
  chunksToWav(chunks: Buffer[], sampleRate: number = 16000): Buffer {
    return pcmChunksToWav(chunks, sampleRate)
  }

  /** Transcribe audio using the configured STT provider. */
  async transcribe(audioData: Buffer, mimeType: string = 'audio/wav'): Promise<{ text: string }> {
    return this.stt.transcribe(audioData, mimeType)
  }

  /** Synthesize text to audio using the configured TTS provider. */
  async synthesize(text: string): Promise<Buffer | null> {
    return this.tts.synthesize(text, 0)
  }

  /** Inject audio into the browser page and manage capture state around playback. */
  async playAudio(buffer: Buffer): Promise<void> {
    if (!this.page) throw new Error('No page set for audio playback')

    this.captureActive = false
    this.echoCanceller.setInjecting(true)

    try {
      this.emit('audio:injection-start', { durationMs: 0 })

      const { durationMs } = await injectAudio(this.page, buffer)

      this.emit('audio:injection-end')

      // Update meter with outbound info
      // (actual frame-level metering happens during injection in the browser)
      this.meter.updateOutbound(new Float32Array([0])) // Reset outbound level
    } finally {
      this.echoCanceller.setInjecting(false)

      setTimeout(() => {
        this.captureActive = true
      }, this.postSpeakDelayMs)
    }
  }

  /** Get current audio levels for admin panel display. */
  getAudioLevels(): AudioLevels {
    return this.meter.getLevels()
  }

  /** Get current WebRTC stats. */
  getWebRTCStats(): WebRTCStats {
    return this.webrtcMonitor.getStats()
  }

  /** Get audio level as percentage (0-100) for UI display. */
  getInboundLevelPercent(): number {
    return this.meter.getInboundPercent()
  }

  /** Get outbound audio level as percentage (0-100) for UI display. */
  getOutboundLevelPercent(): number {
    return this.meter.getOutboundPercent()
  }

  // ── Typed event overloads ──────────────────────────────────

  on<K extends keyof AudioPipelineEvents>(event: K, listener: AudioPipelineEvents[K]): this
  on(event: string, listener: (...args: any[]) => void): this
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener)
  }

  emit<K extends keyof AudioPipelineEvents>(event: K, ...args: Parameters<AudioPipelineEvents[K]>): boolean
  emit(event: string, ...args: any[]): boolean
  emit(event: string, ...args: any[]): boolean {
    return super.emit(event, ...args)
  }

  /** Register a callback for when a gap between speech segments is detected. */
  onGapDetected(handler: (gapMs: number) => void): void {
    this.vad.onGap(handler)
  }

  /** Override the VAD silence duration at runtime (for adaptive silence). */
  setSilenceDuration(ms: number): void {
    this.vad.setSilenceDuration(ms)
  }

  destroy(): void {
    this.captureActive = false

    if (this.meterTimer !== null) {
      clearInterval(this.meterTimer)
      this.meterTimer = null
    }

    this.webrtcMonitor.stop().catch(() => {})
    this.vad.destroy()
    this.echoCanceller.reset()
    this.gainNormalizer.reset()
    this.meter.reset()
    this.page = null
    this.removeAllListeners()
  }

  private calculateEnergy(frame: Float32Array): number {
    let sum = 0
    for (let i = 0; i < frame.length; i++) {
      sum += frame[i] * frame[i]
    }
    return sum / frame.length
  }
}


