// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import express from "express"
import { responseHelpers } from "../../src/server/middleware/response.js"
import { RoomManager, DEFAULT_ROOM_ID } from "../../room-manager.js"

/**
 * Creates a minimal Express app wired up for testing route factories.
 */
export function createTestApp() {
  const app = express()
  app.use(express.json())
  app.use(responseHelpers)

  // Create a mock AgentRegistry backed by an in-memory map
  const agents = new Map()
  const basePrompt = "Test base prompt."
  const defaults = { voice: "alloy" }

  const registry = {
    getAgent: (id) => agents.get(id) || null,
    getAllAgents: () => Array.from(agents.values()),
    addAgent: (cfg) => {
      if (!cfg.id || typeof cfg.id !== "string") throw new Error("Agent must have a string id")
      if (agents.has(cfg.id)) throw new Error(`Agent "${cfg.id}" already exists`)
      if (!cfg.name || typeof cfg.name !== "string") throw new Error("Agent must have a name")
      const agent = {
        id: cfg.id,
        name: cfg.name,
        personality: cfg.personality || "",
        voice: cfg.voice || defaults.voice,
        avatar: cfg.avatar || "",
        theme: cfg.theme || { primary: "#000" }
      }
      agents.set(agent.id, agent)
      return agent
    },
    updateAgent: (id, updates) => {
      const agent = agents.get(id)
      if (!agent) throw new Error(`Agent "${id}" not found`)
      const { id: _ignore, ...safe } = updates
      const updated = { ...agent, ...safe }
      agents.set(id, updated)
      return updated
    },
    removeAgent: (id) => {
      if (!agents.has(id)) throw new Error(`Agent "${id}" not found`)
      agents.delete(id)
    },
    getPublicAgent: (id) => {
      const a = agents.get(id)
      if (!a) return null
      return { id: a.id, name: a.name, voice: a.voice, avatar: a.avatar, theme: a.theme }
    },
    getPublicAgents: () => Array.from(agents.values()).map(a => ({
      id: a.id, name: a.name, voice: a.voice, avatar: a.avatar, theme: a.theme
    })),
    getSystemPrompt: (id) => {
      const a = agents.get(id)
      if (!a) return null
      return `${basePrompt}\n${a.personality || ""}`
    },
    getVoice: (id) => {
      const a = agents.get(id)
      return a?.voice || defaults.voice
    }
  }

  // Seed default agents
  registry.addAgent({ id: "bob", name: "Bob", personality: "Loud one", voice: "verse" })
  registry.addAgent({ id: "alice", name: "Alice", personality: "Chill one", voice: "sage" })

  // Create a real RoomManager for integration tests
  const roomManager = new RoomManager({
    defaultAgents: {
      bob: { id: "bob", name: "Bob" },
      alice: { id: "alice", name: "Alice" }
    }
  })

  // Ensure a default room exists with agents
  const defaultRoom = roomManager.createRoom({ id: DEFAULT_ROOM_ID })
  defaultRoom.agents.bob = { id: "bob", name: "Bob", status: "idle", connected: true, socketId: null }
  defaultRoom.agents.alice = { id: "alice", name: "Alice", status: "offline", connected: false, socketId: null }

  // Mock Socket.IO namespace with .to() chain
  const spaceNS = {
    emit: () => {},
    to: () => ({ emit: () => {} })
  }

  // Mock provider (socket type, with a mock streamResponse)
  const provider = {
    type: "socket",
    async *streamResponse(agentId, userText, systemPrompt, roomId) {
      yield "Hello "
      yield "World"
    },
    clearRoomHistory: () => {}
  }

  const tts = {
    TTS_PROVIDER: "browser"
  }

  return {
    app,
    registry,
    roomManager,
    DEFAULT_ROOM_ID,
    spaceNS,
    provider,
    tts,
    AI_PROVIDER: "openai-chat"
  }
}


