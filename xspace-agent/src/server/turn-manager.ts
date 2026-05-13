// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

import type { Namespace } from "socket.io"
import type { SpaceState } from "./types"

export class TurnManager {
  constructor(
    private state: SpaceState,
    private namespace: Namespace,
  ) {}

  broadcastState(): void {
    this.namespace.emit("stateUpdate", {
      agents: this.state.agents,
      currentTurn: this.state.currentTurn,
      turnQueue: this.state.turnQueue,
    })
  }

  requestTurn(agentId: number): boolean {
    if (this.state.currentTurn === null && !this.state.isProcessing) {
      this.state.currentTurn = agentId
      this.state.isProcessing = true
      this.namespace.emit("turnGranted", { agentId })
      this.broadcastState()
      return true
    }
    if (!this.state.turnQueue.includes(agentId) && this.state.currentTurn !== agentId) {
      this.state.turnQueue.push(agentId)
      this.broadcastState()
    }
    return false
  }

  releaseTurn(agentId: number): void {
    if (this.state.currentTurn === agentId) {
      this.state.currentTurn = null
      this.state.isProcessing = false
      if (this.state.turnQueue.length > 0) {
        const nextAgent = this.state.turnQueue.shift()!
        setTimeout(() => {
          this.state.currentTurn = nextAgent
          this.state.isProcessing = true
          this.namespace.emit("turnGranted", { agentId: nextAgent })
          this.broadcastState()
        }, 500)
      } else {
        this.broadcastState()
      }
    }
  }
}


