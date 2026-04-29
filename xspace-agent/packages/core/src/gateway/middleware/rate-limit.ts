// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

// =============================================================================
// API Gateway — Rate Limiting Middleware
// =============================================================================

import { checkRateLimit as checkRedisRateLimit } from '../../db/redis'
import { rateLimitExceeded } from '../errors'
import type { AuthenticatedRequest, GatewayConfig } from '../types'

interface Request {
  auth?: AuthenticatedRequest
}

interface Response {
  status(code: number): Response
  json(body: unknown): void
  setHeader(name: string, value: string): void
}

type NextFunction = (err?: unknown) => void

/**
 * Creates an Express-compatible per-key rate limiting middleware.
 *
 * Uses Redis sliding window counters. Each API key has its own rate limit
 * (from the key record), falling back to the plan's maxApiCallsPerMinute.
 *
 * Sets standard rate limit headers:
 * - X-RateLimit-Limit: max requests per window
 * - X-RateLimit-Remaining: requests left in current window
 * - X-RateLimit-Reset: Unix timestamp when the window resets
 * - Retry-After: seconds until the client can retry (on 429 only)
 */
export function createRateLimitMiddleware(config: GatewayConfig = {}) {
  const windowSeconds = config.rateLimitWindowSeconds ?? 60

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      // No auth context — skip rate limiting (auth middleware should have rejected)
      return next()
    }

    const { apiKeyId, tenant } = req.auth
    const limit = tenant.quotas.maxApiCallsPerMinute
    const redisKey = `ratelimit:${apiKeyId}`

    try {
      const { allowed, remaining } = await checkRedisRateLimit(redisKey, limit, windowSeconds)

      // Always set rate limit headers
      const resetTimestamp = Math.ceil(Date.now() / 1000) + windowSeconds
      res.setHeader('X-RateLimit-Limit', String(limit))
      res.setHeader('X-RateLimit-Remaining', String(remaining))
      res.setHeader('X-RateLimit-Reset', String(resetTimestamp))

      if (!allowed) {
        res.setHeader('Retry-After', String(windowSeconds))
        const err = rateLimitExceeded(windowSeconds, config.docsBaseUrl)
        res.status(err.statusCode)
        res.json(err.toBody(req.auth.requestId))
        return
      }

      next()
    } catch {
      // If Redis is down, fail open — allow the request
      next()
    }
  }
}


