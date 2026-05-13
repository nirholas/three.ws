// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

let counter = 0

function createTestAgent(overrides = {}) {
  counter++
  return {
    id: overrides.id || `test-agent-${counter}`,
    name: overrides.name || `Test Agent ${counter}`,
    personality: overrides.personality || "A test agent personality.",
    voice: overrides.voice || "alloy",
    avatar: overrides.avatar || "",
    theme: overrides.theme || {
      primary: "#818cf8",
      gradient: ["#667eea", "#764ba2"],
      background: ["#1a1a2e", "#16213e"]
    },
    ...overrides
  }
}

function createTestMessage(overrides = {}) {
  counter++
  return {
    id: overrides.id || `msg-${counter}`,
    agentId: overrides.agentId !== undefined ? overrides.agentId : "bob",
    name: overrides.name || "Bob",
    text: overrides.text || `Test message ${counter}`,
    timestamp: overrides.timestamp || Date.now(),
    ...overrides
  }
}

function createTestRoom(overrides = {}) {
  counter++
  return {
    id: overrides.id || `room-${counter}`,
    agentIds: overrides.agentIds || ["bob", "alice"],
    ...overrides
  }
}

function resetCounter() {
  counter = 0
}

module.exports = { createTestAgent, createTestMessage, createTestRoom, resetCounter }
