// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Simple in-memory rate limiter (no Redis dependency)
// =============================================================================

import type { Request, Response, NextFunction } from 'express'

export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private maxRequests: number,
    private windowMs: number,
  ) {
    // Periodically purge expired windows to prevent memory leaks
    this.cleanupTimer = setInterval(() => this.cleanup(), windowMs * 2)
    this.cleanupTimer.unref() // don't keep process alive
  }

  check(key: string): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now()
    const window = this.windows.get(key)

    if (!window || now > window.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs })
      return { allowed: true }
    }

    if (window.count >= this.maxRequests) {
      return { allowed: false, retryAfterMs: window.resetAt - now }
    }

    window.count++
    return { allowed: true }
  }

  /** Remove expired windows. */
  cleanup(): void {
    const now = Date.now()
    for (const [key, window] of this.windows) {
      if (now > window.resetAt) this.windows.delete(key)
    }
  }

  /** Stop the background cleanup timer (for graceful shutdown / tests). */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }
}

/**
 * Express middleware that enforces per-IP rate limits.
 * Returns 429 when the limit is exceeded.
 */
export function rateLimitMiddleware(limiter: RateLimiter) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown'
    const result = limiter.check(key)

    if (!result.allowed) {
      res
        .status(429)
        .set('Retry-After', String(Math.ceil((result.retryAfterMs ?? 0) / 1000)))
        .json({
          error: 'Too many requests',
          retryAfterMs: result.retryAfterMs,
        })
      return
    }

    next()
  }
}


