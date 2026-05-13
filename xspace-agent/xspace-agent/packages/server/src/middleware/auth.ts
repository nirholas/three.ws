// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§86]

// =============================================================================
// Admin authentication middleware — API key via header, query, or socket auth
// =============================================================================

import { timingSafeEqual } from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import type { Socket } from 'socket.io'

/**
 * Timing-safe comparison to prevent timing attacks on API key checks.
 * Returns false for mismatched lengths without leaking which bytes differ.
 */
function timingSafeApiKeyCompare(provided: string, expected: string): boolean {
  try {
    const a = Buffer.from(provided, 'utf-8')
    const b = Buffer.from(expected, 'utf-8')
    if (a.length !== b.length) {
      // Compare against itself to burn the same time, then return false
      timingSafeEqual(a, a)
      return false
    }
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * Express middleware that requires a valid API key on all routes except /health.
 * Accepts the key via:
 *   - `X-API-Key` header
 *   - `Authorization: Bearer <key>` header
 *   - `?apiKey=<key>` query parameter (convenience for browser access)
 */
export function createAuthMiddleware(apiKey: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip auth for health check
    if (req.path === '/health') return next()

    // Extract key from multiple locations
    const provided =
      (req.headers['x-api-key'] as string) ??
      req.headers['authorization']?.replace('Bearer ', '') ??
      (req.query.apiKey as string)

    if (!provided || !timingSafeApiKeyCompare(provided, apiKey)) {
      res.status(401).json({
        error: 'Unauthorized',
        hint: 'Provide API key via X-API-Key header',
      })
      return
    }

    next()
  }
}

/**
 * Socket.IO authentication middleware.
 * Clients must pass their API key in `socket.handshake.auth.apiKey`
 * or the `x-api-key` handshake header.
 */
export function socketAuthMiddleware(apiKey: string) {
  return (socket: Socket, next: (err?: Error) => void) => {
    const token =
      socket.handshake.auth?.apiKey ??
      socket.handshake.auth?.token ??
      socket.handshake.auth?.bearer ??
      socket.handshake.auth?.authorization?.replace('Bearer ', '') ??
      (socket.handshake.headers?.authorization as string | undefined)?.replace('Bearer ', '') ??
      (socket.handshake.headers?.['x-api-key'] as string)

    if (!token || !timingSafeApiKeyCompare(token, apiKey)) {
      next(new Error('unauthorized'))
      return
    }

    next()
  }
}


