// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§80]

// =============================================================================
// API Gateway — Error Handler Middleware
// =============================================================================

import { ApiError, internalError } from '../errors'
import type { AuthenticatedRequest, GatewayConfig } from '../types'

interface Request {
  auth?: AuthenticatedRequest
}

interface Response {
  status(code: number): Response
  json(body: unknown): void
  headersSent: boolean
}

type NextFunction = (err?: unknown) => void

/**
 * Creates an Express-compatible error handler middleware.
 *
 * Catches all errors thrown by upstream handlers and converts them to
 * the standardized API error response format.
 *
 * Must be registered AFTER all route handlers (Express error middleware
 * signature with 4 parameters).
 */
export function createErrorHandlerMiddleware(config: GatewayConfig = {}) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    // Don't send response if headers already sent
    if (res.headersSent) return

    const requestId = req.auth?.requestId ?? 'unknown'

    if (err instanceof ApiError) {
      res.status(err.statusCode)
      res.json(err.toBody(requestId))
      return
    }

    // Unknown error — wrap as internal error
    const internal = internalError(config.docsBaseUrl)
    res.status(internal.statusCode)
    res.json(internal.toBody(requestId))
  }
}


