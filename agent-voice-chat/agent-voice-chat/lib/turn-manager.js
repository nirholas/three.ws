// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

class TurnManager {
  constructor({ onBroadcast, onTurnGranted } = {}) {
    this.currentTurn = null
    this.turnQueue = []
    this.isProcessing = false
    this.onBroadcast = onBroadcast || (() => {})
    this.onTurnGranted = onTurnGranted || (() => {})
  }

  requestTurn(agentId) {
    if (this.currentTurn === null && !this.isProcessing) {
      this.currentTurn = agentId
      this.isProcessing = true
      this.onTurnGranted(agentId)
      this.onBroadcast()
      return true
    }
    if (!this.turnQueue.includes(agentId) && this.currentTurn !== agentId) {
      this.turnQueue.push(agentId)
      this.onBroadcast()
    }
    return false
  }

  releaseTurn(agentId) {
    if (this.currentTurn !== agentId) return

    this.currentTurn = null
    this.isProcessing = false

    if (this.turnQueue.length > 0) {
      const nextAgent = this.turnQueue.shift()
      setTimeout(() => {
        this.currentTurn = nextAgent
        this.isProcessing = true
        this.onTurnGranted(nextAgent)
        this.onBroadcast()
      }, 500)
    } else {
      this.onBroadcast()
    }
  }

  getState() {
    return {
      currentTurn: this.currentTurn,
      turnQueue: [...this.turnQueue],
      isProcessing: this.isProcessing
    }
  }

  reset() {
    this.currentTurn = null
    this.turnQueue = []
    this.isProcessing = false
  }
}

module.exports = { TurnManager }


