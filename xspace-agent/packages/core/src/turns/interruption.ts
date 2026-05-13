// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import type { InterruptionAction } from '../types'

export interface InterruptionConfig {
  /** Duration threshold (ms) below which external speech is treated as backchannel (default: 500) */
  backchannelThresholdMs?: number
  /** Duration threshold (ms) above which the agent yields (default: 2000) */
  yieldThresholdMs?: number
}

export class InterruptionHandler {
  private speaking = false
  private currentAbortController: AbortController | null = null
  private readonly backchannelMs: number
  private readonly yieldMs: number

  constructor(config: InterruptionConfig = {}) {
    this.backchannelMs = config.backchannelThresholdMs ?? 500
    this.yieldMs = config.yieldThresholdMs ?? 2000
  }

  /** Called when the agent starts speaking */
  onSpeakingStart(abortController: AbortController): void {
    this.speaking = true
    this.currentAbortController = abortController
  }

  /** Called when the agent finishes speaking */
  onSpeakingEnd(): void {
    this.speaking = false
    this.currentAbortController = null
  }

  /** Whether the agent is currently speaking */
  isSpeaking(): boolean {
    return this.speaking
  }

  /**
   * Evaluate external speech detected during our speech output.
   * Returns an action based on how long the external speech has lasted.
   */
  onExternalSpeechDetected(_energy: number, durationMs: number): InterruptionAction {
    if (!this.speaking) return 'ignore'

    // Short burst (< backchannelMs) — probably a backchannel, ignore
    if (durationMs < this.backchannelMs) return 'ignore'

    // Medium (backchannelMs to yieldMs) — someone might be trying to interject
    if (durationMs < this.yieldMs) return 'pause'

    // Long (> yieldMs) — someone is definitely trying to talk, yield
    return 'yield'
  }

  /** Execute the interruption action on the current TTS playback */
  execute(action: InterruptionAction): void {
    switch (action) {
      case 'ignore':
        return

      case 'pause':
        // Abort with 'pause' reason — caller can decide to resume or yield later
        this.currentAbortController?.abort('pause')
        break

      case 'yield':
        // Stop TTS completely, let the other person speak
        this.currentAbortController?.abort('yield')
        this.speaking = false
        this.currentAbortController = null
        break
    }
  }

  /** Reset state (e.g. on leave/destroy) */
  reset(): void {
    this.speaking = false
    this.currentAbortController = null
  }
}


