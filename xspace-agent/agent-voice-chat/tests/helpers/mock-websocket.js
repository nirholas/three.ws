// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const { EventEmitter } = require("events")

/**
 * Mock WebSocket for testing WebRTC/realtime providers.
 * Mimics the browser WebSocket API surface used by realtime providers.
 */
class MockWebSocket extends EventEmitter {
  constructor(url) {
    super()
    this.url = url
    this.readyState = 1 // OPEN
    this.sent = []
    this.CONNECTING = 0
    this.OPEN = 1
    this.CLOSING = 2
    this.CLOSED = 3
  }

  send(data) {
    if (this.readyState !== 1) {
      throw new Error("WebSocket is not open")
    }
    this.sent.push(typeof data === "string" ? JSON.parse(data) : data)
  }

  close(code = 1000, reason = "") {
    this.readyState = 3
    this.emit("close", { code, reason })
  }

  /** Simulate receiving a message from the server */
  simulateMessage(event) {
    this.emit("message", { data: JSON.stringify(event) })
  }

  /** Simulate a WebSocket error */
  simulateError(error) {
    this.emit("error", error instanceof Error ? error : new Error(error))
  }

  /** Simulate the connection opening */
  simulateOpen() {
    this.readyState = 1
    this.emit("open")
  }

  /** Simulate an unexpected close */
  simulateUnexpectedClose(code = 1006, reason = "Abnormal closure") {
    this.readyState = 3
    this.emit("close", { code, reason, wasClean: false })
  }

  /** Reset sent messages for test isolation */
  resetSent() {
    this.sent = []
  }
}

module.exports = { MockWebSocket }


