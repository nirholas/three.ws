// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Database — Redis Client
// =============================================================================

import Redis, { type RedisOptions } from 'ioredis'

let redis: Redis | null = null

export interface RedisConfig {
  url?: string
  host?: string
  port?: number
  password?: string
  db?: number
  maxRetriesPerRequest?: number
  retryDelayMs?: number
  keyPrefix?: string
}

function buildRedisOptions(config: RedisConfig): RedisOptions {
  return {
    host: config.host ?? 'localhost',
    port: config.port ?? 6379,
    password: config.password,
    db: config.db ?? 0,
    maxRetriesPerRequest: config.maxRetriesPerRequest ?? 3,
    retryStrategy(times) {
      const delay = Math.min(times * (config.retryDelayMs ?? 200), 5_000)
      return delay
    },
    keyPrefix: config.keyPrefix ?? 'xspace:',
    lazyConnect: true,
  }
}

/** Initialize the Redis client. */
export function initRedis(config: RedisConfig = {}): Redis {
  if (redis) return redis

  const url = config.url ?? process.env.REDIS_URL

  if (url) {
    redis = new Redis(url, {
      maxRetriesPerRequest: config.maxRetriesPerRequest ?? 3,
      retryStrategy(times) {
        return Math.min(times * (config.retryDelayMs ?? 200), 5_000)
      },
      keyPrefix: config.keyPrefix ?? 'xspace:',
      lazyConnect: true,
    })
  } else {
    redis = new Redis(buildRedisOptions(config))
  }

  redis.on('error', (err) => {
    console.error('[redis] connection error', err.message)
  })

  return redis
}

/** Get the Redis instance. Throws if not initialized. */
export function getRedis(): Redis {
  if (!redis) {
    throw new Error('Redis not initialized. Call initRedis() first.')
  }
  return redis
}

/** Check Redis connectivity. */
export async function checkRedisHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now()
  try {
    const r = getRedis()
    if (r.status !== 'ready') {
      await r.connect()
    }
    await r.ping()
    return { ok: true, latencyMs: Date.now() - start }
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message }
  }
}

/** Close the Redis connection. */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit()
    redis = null
  }
}

// ---------------------------------------------------------------------------
// Helpers for common Redis patterns
// ---------------------------------------------------------------------------

/** Set a JSON value with optional TTL (in seconds). */
export async function setJSON(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  const r = getRedis()
  const json = JSON.stringify(value)
  if (ttlSeconds) {
    await r.setex(key, ttlSeconds, json)
  } else {
    await r.set(key, json)
  }
}

/** Get a parsed JSON value. Returns null if key doesn't exist. */
export async function getJSON<T = unknown>(key: string): Promise<T | null> {
  const r = getRedis()
  const raw = await r.get(key)
  if (!raw) return null
  return JSON.parse(raw) as T
}

/** Sliding-window rate limit check. Returns remaining count. */
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; remaining: number }> {
  const r = getRedis()
  const current = await r.incr(key)
  if (current === 1) {
    await r.expire(key, windowSeconds)
  }
  return {
    allowed: current <= limit,
    remaining: Math.max(0, limit - current),
  }
}


