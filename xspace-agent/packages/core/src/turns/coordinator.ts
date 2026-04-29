// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import type { ResponseDecision } from '../types'

interface AgentTurnState {
  decision: ResponseDecision
  submittedAt: number
  lastSpokeAt?: number
}

export interface CoordinatorConfig {
  /** Time window (ms) to collect decisions before resolving (default: 200) */
  collectionWindowMs?: number
}

export class TurnCoordinator {
  private agents: Map<string, AgentTurnState> = new Map()
  private currentSpeaker: string | null = null
  private readonly collectionWindowMs: number

  constructor(config: CoordinatorConfig = {}) {
    this.collectionWindowMs = config.collectionWindowMs ?? 200
  }

  /** Submit a response decision from an agent */
  submitDecision(agentId: string, decision: ResponseDecision): void {
    if (decision.action !== 'respond') return

    const existing = this.agents.get(agentId)
    this.agents.set(agentId, {
      decision,
      submittedAt: Date.now(),
      lastSpokeAt: existing?.lastSpokeAt,
    })
  }

  /** After a brief collection window, pick the best responder. Returns agent ID or null. */
  async resolveConflicts(): Promise<string | null> {
    await new Promise((r) => setTimeout(r, this.collectionWindowMs))

    const candidates = [...this.agents.entries()]
      .filter((entry): entry is [string, AgentTurnState & { decision: { action: 'respond'; priority: number; reason: string } }] =>
        entry[1].decision.action === 'respond',
      )
      .sort((a, b) => {
        // Higher priority wins
        if (a[1].decision.priority !== b[1].decision.priority) {
          return b[1].decision.priority - a[1].decision.priority
        }
        // Tie-break: agent who spoke least recently
        return (a[1].lastSpokeAt ?? 0) - (b[1].lastSpokeAt ?? 0)
      })

    this.agents.clear()

    if (candidates.length === 0) return null
    return candidates[0][0]
  }

  /**
   * Resolve conflicts synchronously (no wait). Useful when the collection
   * window has already been observed externally.
   */
  resolveConflictsSync(): string | null {
    const candidates = [...this.agents.entries()]
      .filter((entry): entry is [string, AgentTurnState & { decision: { action: 'respond'; priority: number; reason: string } }] =>
        entry[1].decision.action === 'respond',
      )
      .sort((a, b) => {
        if (a[1].decision.priority !== b[1].decision.priority) {
          return b[1].decision.priority - a[1].decision.priority
        }
        return (a[1].lastSpokeAt ?? 0) - (b[1].lastSpokeAt ?? 0)
      })

    this.agents.clear()

    if (candidates.length === 0) return null
    return candidates[0][0]
  }

  /** Record that an agent spoke */
  recordSpoke(agentId: string): void {
    const state = this.agents.get(agentId)
    if (state) {
      state.lastSpokeAt = Date.now()
    }
    // Also update even if not in current round
    this.currentSpeaker = agentId
  }

  /** Get the current speaker ID */
  getCurrentSpeaker(): string | null {
    return this.currentSpeaker
  }

  /** Clear the current speaker */
  clearCurrentSpeaker(): void {
    this.currentSpeaker = null
  }

  /** Get the number of pending decisions */
  getPendingCount(): number {
    return this.agents.size
  }

  /** Reset all state */
  reset(): void {
    this.agents.clear()
    this.currentSpeaker = null
  }
}


