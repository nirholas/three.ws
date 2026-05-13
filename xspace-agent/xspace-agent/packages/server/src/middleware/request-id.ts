// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

// =============================================================================
// Request ID middleware — generates or forwards X-Request-ID on every request
// =============================================================================

import type { Request, Response, NextFunction } from 'express'
import { randomUUID } from 'crypto'
import { getAppLogger } from 'xspace-agent'

/**
 * Attaches a unique request ID to every request. If the client sends an
 * `X-Request-ID` header it is reused; otherwise a new UUIDv4 is generated.
 *
 * Sets `req.id` and echoes the ID back via the `X-Request-ID` response header.
 * Also attaches a child logger at `req.log`.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const id = (req.headers['x-request-id'] as string) ?? randomUUID()
  ;(req as any).id = id
  res.setHeader('X-Request-ID', id)
  ;(req as any).log = getAppLogger('http').child({
    requestId: id,
    method: req.method,
    path: req.path,
  })
  next()
}


