// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

'use strict'

const {
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  AUDIO_MAX_CHUNKS_PER_SECOND,
  AUDIO_MAX_BYTES_PER_MINUTE,
  RATE_LIMIT_TIERS
} = require("../constants")

// ── Distributed Socket Rate Limiter (Redis-backed) ──────────────────────────

/**
 * Creates a distributed socket rate limiter that uses Redis when available,
 * falling back to in-memory tracking.
 *
 * @param {import('redis').RedisClientType | null} redisClient - Connected Redis client or null
 */
function createDistributedSocketRateLimiter(redisClient) {
  // In-memory fallback store
  const localLimits = new Map()

  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of localLimits) {
      if (now - entry.windowStart > DEFAULT_RATE_LIMIT_WINDOW_MS) {
        localLimits.delete(key)
      }
    }
  }, 60000)
  if (cleanupInterval.unref) cleanupInterval.unref()

  /**
   * Check rate limit using Redis (distributed).
   * @returns {Promise<boolean>} true if BLOCKED
   */
  async function checkRedis(key, limit, windowMs) {
    try {
      const current = await redisClient.incr(key)
      if (current === 1) {
        await redisClient.pExpire(key, windowMs)
      }
      return current > limit
    } catch {
      // Redis failure — fall through to in-memory
      return checkLocal(key, limit, windowMs)
    }
  }

  /**
   * Check rate limit using in-memory store (single instance).
   * @returns {boolean} true if BLOCKED
   */
  function checkLocal(key, limit, windowMs) {
    const now = Date.now()

    if (!localLimits.has(key)) {
      localLimits.set(key, { count: 1, windowStart: now })
      return false
    }

    const entry = localLimits.get(key)

    if (now - entry.windowStart > windowMs) {
      entry.count = 1
      entry.windowStart = now
      return false
    }

    entry.count++
    return entry.count > limit
  }

  return {
    /**
     * Check if an event from a user/socket should be rate-limited.
     * Uses userId for distributed tracking, falls back to socketId.
     *
     * @param {string} userId - User identifier (user:id, key:hash, or ip:addr)
     * @param {string} event - Event name
     * @param {number} limit - Max events per window
     * @param {number} [windowMs] - Window duration in ms
     * @returns {Promise<boolean>} true if the event should be BLOCKED
     */
    async check(userId, event, limit, windowMs = DEFAULT_RATE_LIMIT_WINDOW_MS) {
      const key = `ratelimit:socket:${userId}:${event}`

      if (redisClient) {
        return checkRedis(key, limit, windowMs)
      }
      return checkLocal(key, limit, windowMs)
    },

    /**
     * Clean up all entries for a user/socket.
     * @param {string} userId
     */
    async cleanup(userId) {
      // Clean local entries
      for (const key of localLimits.keys()) {
        if (key.includes(`:${userId}:`)) {
          localLimits.delete(key)
        }
      }

      // Clean Redis entries (best-effort scan)
      if (redisClient) {
        try {
          const pattern = `ratelimit:socket:${userId}:*`
          let cursor = "0"
          do {
            const result = await redisClient.scan(cursor, { MATCH: pattern, COUNT: 100 })
            cursor = result.cursor.toString()
            if (result.keys.length > 0) {
              await redisClient.del(result.keys)
            }
          } while (cursor !== "0")
        } catch {
          // Redis cleanup failure is non-fatal
        }
      }
    },

    /**
     * Stop background cleanup (call on server shutdown).
     */
    stopCleanup() {
      clearInterval(cleanupInterval)
    },

    /**
     * Expose local map size for metrics.
     */
    get size() {
      return localLimits.size
    }
  }
}

// ── Audio Rate Limiter ──────────────────────────────────────────────────────

/**
 * Creates a rate limiter specifically for audio chunks, which need higher
 * throughput than regular events.
 *
 * @param {import('redis').RedisClientType | null} redisClient
 */
function createAudioRateLimiter(redisClient) {
  const chunkCounts = new Map()
  const byteCounts = new Map()

  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of chunkCounts) {
      if (now - entry.windowStart > 1000) chunkCounts.delete(key)
    }
    for (const [key, entry] of byteCounts) {
      if (now - entry.windowStart > 60000) byteCounts.delete(key)
    }
  }, 10000)
  if (cleanupInterval.unref) cleanupInterval.unref()

  return {
    /**
     * Check if an audio chunk should be rate-limited.
     *
     * @param {string} userId - User identifier
     * @param {number} chunkBytes - Size of the audio chunk in bytes
     * @returns {{ blocked: boolean, reason?: string }}
     */
    check(userId, chunkBytes) {
      const now = Date.now()

      // Check chunks per second
      const chunkKey = `audio:chunks:${userId}`
      if (!chunkCounts.has(chunkKey)) {
        chunkCounts.set(chunkKey, { count: 1, windowStart: now })
      } else {
        const entry = chunkCounts.get(chunkKey)
        if (now - entry.windowStart > 1000) {
          entry.count = 1
          entry.windowStart = now
        } else {
          entry.count++
          if (entry.count > AUDIO_MAX_CHUNKS_PER_SECOND) {
            return { blocked: true, reason: "audio_chunks_per_second_exceeded" }
          }
        }
      }

      // Check bytes per minute
      const byteKey = `audio:bytes:${userId}`
      if (!byteCounts.has(byteKey)) {
        byteCounts.set(byteKey, { bytes: chunkBytes, windowStart: now })
      } else {
        const entry = byteCounts.get(byteKey)
        if (now - entry.windowStart > 60000) {
          entry.bytes = chunkBytes
          entry.windowStart = now
        } else {
          entry.bytes += chunkBytes
          if (entry.bytes > AUDIO_MAX_BYTES_PER_MINUTE) {
            return { blocked: true, reason: "audio_bytes_per_minute_exceeded" }
          }
        }
      }

      return { blocked: false }
    },

    cleanup(userId) {
      for (const key of chunkCounts.keys()) {
        if (key.includes(userId)) chunkCounts.delete(key)
      }
      for (const key of byteCounts.keys()) {
        if (key.includes(userId)) byteCounts.delete(key)
      }
    },

    stopCleanup() {
      clearInterval(cleanupInterval)
    }
  }
}

// ── Socket user key helper ──────────────────────────────────────────────────

/**
 * Extract a rate-limit key from a socket. Uses authenticated user info if
 * available, falls back to socket ID.
 *
 * @param {import('socket.io').Socket} socket
 * @returns {string}
 */
function getSocketUserKey(socket) {
  if (socket.data?.user?.sub) return `user:${socket.data.user.sub}`
  if (socket.data?.user?.apiKeyHash) return `key:${socket.data.user.apiKeyHash}`
  return `ip:${socket.handshake.address}`
}

/**
 * Get the role-based event limit for a socket user.
 *
 * @param {import('socket.io').Socket} socket
 * @param {number} defaultLimit
 * @returns {number}
 */
function getSocketRoleLimit(socket, defaultLimit) {
  const role = socket.data?.user?.role || "anonymous"
  const tiers = RATE_LIMIT_TIERS[role]
  if (tiers && tiers.message !== undefined) return tiers.message
  return defaultLimit
}

module.exports = {
  createDistributedSocketRateLimiter,
  createAudioRateLimiter,
  getSocketUserKey,
  getSocketRoleLimit
}


