// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

const DEFAULT_MAX_HISTORY = 20

class ConversationHistory {
  constructor(maxHistory = DEFAULT_MAX_HISTORY) {
    this.maxHistory = maxHistory
    this.histories = {}
  }

  _key(roomId, agentId) {
    return `${roomId || "default"}:${agentId}`
  }

  add(roomId, agentId, role, content) {
    const key = this._key(roomId, agentId)
    if (!this.histories[key]) this.histories[key] = []
    this.histories[key].push({ role, content })
    if (this.histories[key].length > this.maxHistory) {
      this.histories[key] = this.histories[key].slice(-this.maxHistory)
    }
  }

  get(roomId, agentId) {
    return this.histories[this._key(roomId, agentId)] || []
  }

  clear(agentId, roomId) {
    delete this.histories[this._key(roomId, agentId)]
  }

  clearRoom(roomId) {
    const prefix = `${roomId}:`
    for (const key of Object.keys(this.histories)) {
      if (key.startsWith(prefix)) delete this.histories[key]
    }
  }
}

module.exports = { ConversationHistory }
