// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Tests — Redis Client
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock ioredis
// ---------------------------------------------------------------------------

const mockRedisInstance: Record<string, any> = {
  on: vi.fn().mockReturnThis(),
  connect: vi.fn().mockResolvedValue(undefined),
  quit: vi.fn().mockResolvedValue('OK'),
  ping: vi.fn().mockResolvedValue('PONG'),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  setex: vi.fn().mockResolvedValue('OK'),
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  status: 'ready',
}

// A function that can be used as a constructor (with `new`) and returns our mock.
// The Redis constructor is called with either (url, options) or (options).
// We capture the args so tests can inspect them.
let constructorCalls: any[][] = []
function MockRedis(...args: any[]) {
  constructorCalls.push(args)
  return mockRedisInstance
}

// We need a fresh module for each test to reset the singleton
let redisModule: typeof import('../../../src/db/redis')

async function freshModule() {
  vi.resetModules()

  vi.doMock('ioredis', () => ({
    default: MockRedis,
  }))

  return await import('../../../src/db/redis')
}

describe('Redis Client', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    constructorCalls = []
    mockRedisInstance.on = vi.fn().mockReturnThis()
    mockRedisInstance.connect = vi.fn().mockResolvedValue(undefined)
    mockRedisInstance.quit = vi.fn().mockResolvedValue('OK')
    mockRedisInstance.ping = vi.fn().mockResolvedValue('PONG')
    mockRedisInstance.get = vi.fn().mockResolvedValue(null)
    mockRedisInstance.set = vi.fn().mockResolvedValue('OK')
    mockRedisInstance.setex = vi.fn().mockResolvedValue('OK')
    mockRedisInstance.incr = vi.fn().mockResolvedValue(1)
    mockRedisInstance.expire = vi.fn().mockResolvedValue(1)
    mockRedisInstance.status = 'ready'
    redisModule = await freshModule()
  })

  // -------------------------------------------------------------------------
  // initRedis
  // -------------------------------------------------------------------------

  describe('initRedis', () => {
    it('should create a Redis instance and return it', () => {
      const client = redisModule.initRedis({ host: 'localhost', port: 6379 })

      expect(client).toBe(mockRedisInstance)
      expect(constructorCalls).toHaveLength(1)
    })

    it('should return the same instance on repeated calls (singleton)', () => {
      const client1 = redisModule.initRedis()
      const client2 = redisModule.initRedis()

      expect(client1).toBe(client2)
      expect(constructorCalls).toHaveLength(1)
    })

    it('should use URL when provided in config', () => {
      redisModule.initRedis({ url: 'redis://myhost:6380/1' })

      expect(constructorCalls).toHaveLength(1)
      // First arg is the URL string
      expect(constructorCalls[0][0]).toBe('redis://myhost:6380/1')
      // Second arg is options object
      const opts = constructorCalls[0][1]
      expect(opts.maxRetriesPerRequest).toBe(3)
      expect(opts.keyPrefix).toBe('xspace:')
      expect(opts.lazyConnect).toBe(true)
    })

    it('should prefer REDIS_URL env var when no url in config', () => {
      const original = process.env.REDIS_URL
      process.env.REDIS_URL = 'redis://env-redis:6379'

      try {
        redisModule.initRedis()
        expect(constructorCalls[0][0]).toBe('redis://env-redis:6379')
      } finally {
        if (original === undefined) {
          delete process.env.REDIS_URL
        } else {
          process.env.REDIS_URL = original
        }
      }
    })

    it('should use individual config options when no URL', () => {
      redisModule.initRedis({
        host: 'redis-host',
        port: 6380,
        password: 'secret',
        db: 2,
        keyPrefix: 'test:',
      })

      expect(constructorCalls).toHaveLength(1)
      const config = constructorCalls[0][0]
      expect(config.host).toBe('redis-host')
      expect(config.port).toBe(6380)
      expect(config.password).toBe('secret')
      expect(config.db).toBe(2)
      expect(config.keyPrefix).toBe('test:')
      expect(config.lazyConnect).toBe(true)
    })

    it('should apply default options', () => {
      redisModule.initRedis({})

      const config = constructorCalls[0][0]
      expect(config.host).toBe('localhost')
      expect(config.port).toBe(6379)
      expect(config.db).toBe(0)
      expect(config.maxRetriesPerRequest).toBe(3)
      expect(config.keyPrefix).toBe('xspace:')
      expect(config.lazyConnect).toBe(true)
    })

    it('should register an error handler', () => {
      redisModule.initRedis()

      expect(mockRedisInstance.on).toHaveBeenCalledWith('error', expect.any(Function))
    })

    it('should log redis errors via console.error', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      redisModule.initRedis()

      const errorCallback = mockRedisInstance.on.mock.calls.find(
        (call: any[]) => call[0] === 'error',
      )?.[1]
      expect(errorCallback).toBeDefined()

      errorCallback(new Error('connection lost'))

      expect(consoleSpy).toHaveBeenCalledWith('[redis] connection error', 'connection lost')
      consoleSpy.mockRestore()
    })

    it('should use custom retryDelayMs and maxRetriesPerRequest', () => {
      redisModule.initRedis({ maxRetriesPerRequest: 5, retryDelayMs: 500 })

      const config = constructorCalls[0][0]
      expect(config.maxRetriesPerRequest).toBe(5)
      expect(typeof config.retryStrategy).toBe('function')
    })

    it('should cap retry delay at 5000ms', () => {
      redisModule.initRedis({ retryDelayMs: 200 })

      const config = constructorCalls[0][0]
      // 200 * 100 = 20000, capped at 5000
      const delay = config.retryStrategy(100)
      expect(delay).toBe(5000)
    })

    it('should scale retry delay linearly with times', () => {
      redisModule.initRedis({ retryDelayMs: 200 })

      const config = constructorCalls[0][0]
      expect(config.retryStrategy(1)).toBe(200)
      expect(config.retryStrategy(3)).toBe(600)
      expect(config.retryStrategy(10)).toBe(2000)
    })
  })

  // -------------------------------------------------------------------------
  // getRedis
  // -------------------------------------------------------------------------

  describe('getRedis', () => {
    it('should throw when Redis is not initialized', () => {
      expect(() => redisModule.getRedis()).toThrow(
        'Redis not initialized. Call initRedis() first.',
      )
    })

    it('should return the Redis instance after init', () => {
      redisModule.initRedis()
      expect(redisModule.getRedis()).toBe(mockRedisInstance)
    })
  })

  // -------------------------------------------------------------------------
  // checkRedisHealth
  // -------------------------------------------------------------------------

  describe('checkRedisHealth', () => {
    it('should return ok: true when ping succeeds', async () => {
      redisModule.initRedis()

      const result = await redisModule.checkRedisHealth()

      expect(result.ok).toBe(true)
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
      expect(result.error).toBeUndefined()
      expect(mockRedisInstance.ping).toHaveBeenCalled()
    })

    it('should connect if status is not ready', async () => {
      mockRedisInstance.status = 'wait'
      redisModule.initRedis()

      await redisModule.checkRedisHealth()

      expect(mockRedisInstance.connect).toHaveBeenCalled()
    })

    it('should not call connect if already ready', async () => {
      mockRedisInstance.status = 'ready'
      redisModule.initRedis()

      await redisModule.checkRedisHealth()

      expect(mockRedisInstance.connect).not.toHaveBeenCalled()
    })

    it('should return ok: false when ping fails', async () => {
      mockRedisInstance.ping = vi.fn().mockRejectedValue(new Error('timeout'))
      redisModule.initRedis()

      const result = await redisModule.checkRedisHealth()

      expect(result.ok).toBe(false)
      expect(result.error).toBe('timeout')
    })

    it('should return ok: false when getRedis throws (not initialized)', async () => {
      // Don't init -- getRedis will throw
      const result = await redisModule.checkRedisHealth()

      expect(result.ok).toBe(false)
      expect(result.error).toContain('Redis not initialized')
    })
  })

  // -------------------------------------------------------------------------
  // closeRedis
  // -------------------------------------------------------------------------

  describe('closeRedis', () => {
    it('should call quit and nullify the singleton', async () => {
      redisModule.initRedis()
      await redisModule.closeRedis()

      expect(mockRedisInstance.quit).toHaveBeenCalledTimes(1)
      // After closing, getRedis should throw
      expect(() => redisModule.getRedis()).toThrow('Redis not initialized')
    })

    it('should be a no-op when not initialized', async () => {
      await expect(redisModule.closeRedis()).resolves.toBeUndefined()
      expect(mockRedisInstance.quit).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // setJSON
  // -------------------------------------------------------------------------

  describe('setJSON', () => {
    it('should store JSON string without TTL', async () => {
      redisModule.initRedis()

      await redisModule.setJSON('user:1', { name: 'Alice', age: 30 })

      expect(mockRedisInstance.set).toHaveBeenCalledWith(
        'user:1',
        JSON.stringify({ name: 'Alice', age: 30 }),
      )
      expect(mockRedisInstance.setex).not.toHaveBeenCalled()
    })

    it('should store JSON string with TTL using setex', async () => {
      redisModule.initRedis()

      await redisModule.setJSON('user:1', { name: 'Alice' }, 3600)

      expect(mockRedisInstance.setex).toHaveBeenCalledWith(
        'user:1',
        3600,
        JSON.stringify({ name: 'Alice' }),
      )
      expect(mockRedisInstance.set).not.toHaveBeenCalled()
    })

    it('should handle complex nested objects', async () => {
      redisModule.initRedis()

      const data = { agents: [{ id: 1, config: { nested: true } }], meta: null }
      await redisModule.setJSON('complex', data)

      expect(mockRedisInstance.set).toHaveBeenCalledWith('complex', JSON.stringify(data))
    })
  })

  // -------------------------------------------------------------------------
  // getJSON
  // -------------------------------------------------------------------------

  describe('getJSON', () => {
    it('should return parsed JSON from Redis', async () => {
      mockRedisInstance.get = vi.fn().mockResolvedValue('{"name":"Alice","age":30}')
      redisModule.initRedis()

      const result = await redisModule.getJSON<{ name: string; age: number }>('user:1')

      expect(result).toEqual({ name: 'Alice', age: 30 })
    })

    it('should return null when key does not exist', async () => {
      mockRedisInstance.get = vi.fn().mockResolvedValue(null)
      redisModule.initRedis()

      const result = await redisModule.getJSON('nonexistent')

      expect(result).toBeNull()
    })

    it('should throw on invalid JSON', async () => {
      mockRedisInstance.get = vi.fn().mockResolvedValue('not-valid-json')
      redisModule.initRedis()

      await expect(redisModule.getJSON('bad')).rejects.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // checkRateLimit
  // -------------------------------------------------------------------------

  describe('checkRateLimit', () => {
    it('should return allowed: true when under the limit', async () => {
      mockRedisInstance.incr = vi.fn().mockResolvedValue(3)
      redisModule.initRedis()

      const result = await redisModule.checkRateLimit('api:user:1', 10, 60)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(7)
    })

    it('should return allowed: false when over the limit', async () => {
      mockRedisInstance.incr = vi.fn().mockResolvedValue(11)
      redisModule.initRedis()

      const result = await redisModule.checkRateLimit('api:user:1', 10, 60)

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('should set TTL on first increment (current === 1)', async () => {
      mockRedisInstance.incr = vi.fn().mockResolvedValue(1)
      redisModule.initRedis()

      await redisModule.checkRateLimit('api:user:1', 10, 60)

      expect(mockRedisInstance.expire).toHaveBeenCalledWith('api:user:1', 60)
    })

    it('should not set TTL on subsequent increments', async () => {
      mockRedisInstance.incr = vi.fn().mockResolvedValue(5)
      redisModule.initRedis()

      await redisModule.checkRateLimit('api:user:1', 10, 60)

      expect(mockRedisInstance.expire).not.toHaveBeenCalled()
    })

    it('should return remaining: 0 when over the limit (no negatives)', async () => {
      mockRedisInstance.incr = vi.fn().mockResolvedValue(100)
      redisModule.initRedis()

      const result = await redisModule.checkRateLimit('api:user:1', 10, 60)

      expect(result.remaining).toBe(0)
    })

    it('should handle exact limit boundary', async () => {
      mockRedisInstance.incr = vi.fn().mockResolvedValue(10)
      redisModule.initRedis()

      const result = await redisModule.checkRateLimit('api:user:1', 10, 60)

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(0)
    })
  })
})


