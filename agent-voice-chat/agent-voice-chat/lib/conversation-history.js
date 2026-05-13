// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

class ConversationHistory {
  constructor({ maxLength = 100 } = {}) {
    this.maxLength = maxLength
    this.histories = new Map()
  }

  add(message, key = "global") {
    if (!this.histories.has(key)) {
      this.histories.set(key, [])
    }
    const history = this.histories.get(key)
    history.push(message)
    if (history.length > this.maxLength) {
      this.histories.set(key, history.slice(-this.maxLength))
    }
  }

  get(key = "global") {
    return [...(this.histories.get(key) || [])]
  }

  clear(key) {
    if (key !== undefined) {
      this.histories.delete(key)
    } else {
      this.histories.clear()
    }
  }

  getRecent(key = "global", count = 50) {
    const history = this.histories.get(key) || []
    return [...history.slice(-count)]
  }

  size(key = "global") {
    return (this.histories.get(key) || []).length
  }

  keys() {
    return Array.from(this.histories.keys())
  }
}

module.exports = { ConversationHistory }


