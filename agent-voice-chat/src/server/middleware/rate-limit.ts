// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

import type { Request, Response, NextFunction } from "express"
import type { Socket } from "socket.io"
import { serverLogger } from "../logger"

// ===== In-Memory Rate Limiter =====

interface RateLimitWindow {
  count: number
  resetAt: number
}

class RateLimiter {
  private windows = new Map<string, RateLimitWindow>()
  private cleanupTimer: ReturnType<typeof setInterval>

  constructor(
    public readonly max: number,
    public readonly windowMs: number,
  ) {
    // Clean up expired windows every 60s to prevent memory leaks
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000)
    this.cleanupTimer.unref()
  }

  check(key: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now()
    const window = this.windows.get(key)

    if (!window || now >= window.resetAt) {
      const resetAt = now + this.windowMs
      this.windows.set(key, { count: 1, resetAt })
      return { allowed: true, remaining: this.max - 1, resetAt }
    }

    window.count++
    const allowed = window.count <= this.max
    return {
      allowed,
      remaining: Math.max(0, this.max - window.count),
      resetAt: window.resetAt,
    }
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, window] of this.windows) {
      if (now >= window.resetAt) this.windows.delete(key)
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer)
    this.windows.clear()
  }
}

// ===== Express Rate Limit Middleware =====

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"]
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim()
  return req.socket.remoteAddress || "unknown"
}

/** Global rate limiter: 100 requests/min per IP */
const globalLimiter = new RateLimiter(100, 60_000)

/** Strict rate limiter for expensive operations: 5 requests/min per IP */
const expensiveLimiter = new RateLimiter(5, 60_000)

/** Provider verify rate limiter: 10 requests/min per IP */
const providerLimiter = new RateLimiter(10, 60_000)

/** Auth rate limiter: 5 requests/15min per IP */
const authLimiter = new RateLimiter(5, 15 * 60_000)

function sendRateLimitResponse(res: Response, resetAt: number): void {
  const retryAfter = Math.ceil((resetAt - Date.now()) / 1000)
  res.set("Retry-After", String(retryAfter))
  res.status(429).json({
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests",
      hint: `Wait ${retryAfter} seconds`,
    },
  })
}

export function globalRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = getClientIp(req)
  const result = globalLimiter.check(ip)

  res.set("X-RateLimit-Limit", String(globalLimiter.max))
  res.set("X-RateLimit-Remaining", String(result.remaining))
  res.set("X-RateLimit-Reset", String(Math.ceil(result.resetAt / 1000)))

  if (!result.allowed) {
    sendRateLimitResponse(res, result.resetAt)
    return
  }
  next()
}

export function expensiveRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = getClientIp(req)
  const result = expensiveLimiter.check(`expensive:${ip}`)
  if (!result.allowed) {
    sendRateLimitResponse(res, result.resetAt)
    return
  }
  next()
}

export function providerRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = getClientIp(req)
  const result = providerLimiter.check(`provider:${ip}`)
  if (!result.allowed) {
    sendRateLimitResponse(res, result.resetAt)
    return
  }
  next()
}

export function authRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = getClientIp(req)
  const result = authLimiter.check(`auth:${ip}`)
  if (!result.allowed) {
    sendRateLimitResponse(res, result.resetAt)
    return
  }
  next()
}

// ===== Socket.IO Rate Limiting =====

const socketMessageCounts = new Map<string, { count: number; resetAt: number }>()
const SOCKET_MAX_PER_MINUTE = 12

/** Clean up socket rate limit entries every 60s */
const socketCleanup = setInterval(() => {
  const now = Date.now()
  for (const [key, window] of socketMessageCounts) {
    if (now >= window.resetAt) socketMessageCounts.delete(key)
  }
}, 60_000)
socketCleanup.unref()

export function checkSocketRateLimit(socket: Socket): boolean {
  const now = Date.now()
  const entry = socketMessageCounts.get(socket.id)

  if (!entry || now >= entry.resetAt) {
    socketMessageCounts.set(socket.id, { count: 1, resetAt: now + 60_000 })
    return true
  }

  entry.count++
  if (entry.count > SOCKET_MAX_PER_MINUTE) {
    serverLogger.warn({ socketId: socket.id, limit: SOCKET_MAX_PER_MINUTE }, "socket rate limit exceeded")
    socket.emit("xSpacesError", {
      error: "Rate limit exceeded. Please slow down.",
    })
    if (entry.count > SOCKET_MAX_PER_MINUTE * 2) {
      serverLogger.warn({ socketId: socket.id }, "disconnecting socket for excessive messages")
      socket.disconnect(true)
    }
    return false
  }
  return true
}

export function cleanupSocketRateLimit(socketId: string): void {
  socketMessageCounts.delete(socketId)
}


