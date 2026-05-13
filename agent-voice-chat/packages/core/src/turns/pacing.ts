// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import type { ConversationPace } from '../types'

export interface PacingConfig {
  /** Override delays per pace (ms). Defaults: rapid=300, normal=800, slow=1500 */
  delays?: Partial<Record<ConversationPace, number>>
  /** Maximum random jitter added to delay (ms, default: 300) */
  maxJitterMs?: number
}

export class ResponsePacer {
  private pace: ConversationPace = 'normal'
  private readonly delays: Record<ConversationPace, number>
  private readonly maxJitter: number

  constructor(config: PacingConfig = {}) {
    this.delays = {
      rapid: config.delays?.rapid ?? 300,
      normal: config.delays?.normal ?? 800,
      slow: config.delays?.slow ?? 1500,
    }
    this.maxJitter = config.maxJitterMs ?? 300
  }

  /** Update the conversation pace */
  setPace(pace: ConversationPace): void {
    this.pace = pace
  }

  /** Get the current pace */
  getPace(): ConversationPace {
    return this.pace
  }

  /** Wait for a natural-feeling delay before responding */
  async preResponseDelay(): Promise<void> {
    const base = this.delays[this.pace]
    const jitter = Math.random() * this.maxJitter
    await new Promise((r) => setTimeout(r, base + jitter))
  }

  /** Whether to send a "thinking" indicator before responding */
  shouldSendThinkingSignal(): boolean {
    // Only in slow-paced conversations where the delay is noticeable
    return this.pace === 'slow'
  }

  /** Get the base delay for the current pace (useful for testing) */
  getBaseDelay(): number {
    return this.delays[this.pace]
  }
}


