// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

const { nanoid } = require("nanoid")
const { CircularBuffer } = require("./src/server/utils/circular-buffer")
const { logger } = require("./src/server/logger")

const DEFAULT_ROOM_ID = "default"
const DEFAULT_TTL_MINUTES = 30
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

class RoomManager {
  constructor(opts = {}) {
    this.rooms = new Map()
    this.defaultAgents = opts.defaultAgents || {
      bob: { id: "bob", name: "Bob" },
      alice: { id: "alice", name: "Alice" }
    }
    this._cleanupTimer = setInterval(() => this.cleanupStaleRooms(), CLEANUP_INTERVAL_MS)
  }

  createRoom(config = {}) {
    const id = config.id || nanoid(10)
    if (this.rooms.has(id)) return this.rooms.get(id)

    const agentIds = config.agentIds || Object.keys(this.defaultAgents)
    const agents = {}
    for (const aid of agentIds) {
      const base = this.defaultAgents[aid]
      if (base) {
        agents[aid] = { id: aid, name: base.name, status: "offline", connected: false, socketId: null }
      }
    }

    const room = {
      id,
      agents,
      currentTurn: null,
      turnQueue: [],
      messages: new CircularBuffer(100),
      isProcessing: false,
      clients: new Set(),
      createdAt: new Date(),
      lastActivity: new Date(),
      config: {
        agentIds,
        maxParticipants: config.maxParticipants || 50,
        ttlMinutes: config.ttlMinutes || DEFAULT_TTL_MINUTES,
        isPublic: config.isPublic !== undefined ? config.isPublic : true
      }
    }

    this.rooms.set(id, room)
    return room
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) || null
  }

  getOrCreateRoom(roomId) {
    let room = this.rooms.get(roomId)
    if (!room) {
      room = this.createRoom({ id: roomId })
    }
    return room
  }

  deleteRoom(roomId) {
    if (roomId === DEFAULT_ROOM_ID) return false
    return this.rooms.delete(roomId)
  }

  listRooms() {
    const list = []
    for (const room of this.rooms.values()) {
      list.push({
        id: room.id,
        clientCount: room.clients.size,
        agentCount: Object.keys(room.agents).length,
        createdAt: room.createdAt,
        lastActivity: room.lastActivity,
        config: room.config
      })
    }
    return list
  }

  cleanupStaleRooms() {
    const now = Date.now()
    let cleaned = 0
    for (const [id, room] of this.rooms) {
      if (id === DEFAULT_ROOM_ID) continue
      if (room.clients.size > 0) continue
      const elapsed = (now - room.lastActivity.getTime()) / 60000
      if (elapsed >= room.config.ttlMinutes) {
        this.rooms.delete(id)
        cleaned++
      }
    }
    if (cleaned > 0) logger.info({ cleaned }, "Cleaned up stale rooms")
    return cleaned
  }

  touchRoom(roomId) {
    const room = this.rooms.get(roomId)
    if (room) room.lastActivity = new Date()
  }

  addClient(roomId, socketId) {
    const room = this.rooms.get(roomId)
    if (!room) return false
    room.clients.add(socketId)
    room.lastActivity = new Date()
    return true
  }

  removeClient(roomId, socketId) {
    const room = this.rooms.get(roomId)
    if (!room) return
    room.clients.delete(socketId)
    room.lastActivity = new Date()
  }

  getRoomForSocket(socketId) {
    for (const room of this.rooms.values()) {
      if (room.clients.has(socketId)) return room
    }
    return null
  }

  getRoomCount() {
    return this.rooms.size
  }

  destroy() {
    clearInterval(this._cleanupTimer)
  }
}

module.exports = { RoomManager, DEFAULT_ROOM_ID }
