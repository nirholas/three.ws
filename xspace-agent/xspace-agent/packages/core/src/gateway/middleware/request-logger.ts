// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

// =============================================================================
// API Gateway — Request/Response Logging Middleware
// =============================================================================

import type { AuthenticatedRequest, ApiRequestLog, GatewayConfig } from '../types'

interface Request {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  auth?: AuthenticatedRequest
  socket?: { remoteAddress?: string }
}

interface Response {
  statusCode: number
  on(event: string, listener: () => void): void
  getHeader(name: string): string | number | string[] | undefined
}

type NextFunction = (err?: unknown) => void

/** Subscribers that receive log entries. */
export type RequestLogHandler = (log: ApiRequestLog) => void

const logHandlers: RequestLogHandler[] = []

/** Register a handler that receives every API request log entry. */
export function onRequestLog(handler: RequestLogHandler): void {
  logHandlers.push(handler)
}

/** Remove a previously registered log handler. */
export function offRequestLog(handler: RequestLogHandler): void {
  const idx = logHandlers.indexOf(handler)
  if (idx >= 0) logHandlers.splice(idx, 1)
}

/** Clear all registered log handlers (for testing). */
export function clearRequestLogHandlers(): void {
  logHandlers.length = 0
}

function getHeader(req: Request, name: string): string {
  const val = req.headers[name] ?? req.headers[name.toLowerCase()]
  if (!val) return ''
  return Array.isArray(val) ? val[0] : val
}

function getContentLength(res: Response): number {
  const val = res.getHeader('content-length')
  if (typeof val === 'number') return val
  if (typeof val === 'string') return parseInt(val, 10) || 0
  return 0
}

/**
 * Creates an Express-compatible request/response logging middleware.
 *
 * Captures method, path, status, latency, sizes, and emits structured
 * log entries to all registered handlers. Logs are emitted on response finish.
 */
export function createRequestLoggerMiddleware(config: GatewayConfig = {}) {
  if (config.enableRequestLogging === false) {
    return (_req: Request, _res: Response, next: NextFunction) => next()
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = req.auth?.startTime ?? Date.now()

    res.on('finish', () => {
      const log: ApiRequestLog = {
        requestId: req.auth?.requestId ?? '',
        orgId: req.auth?.tenant?.orgId ?? '',
        apiKeyPrefix: req.auth?.apiKeyPrefix ?? '',
        method: req.method ?? 'UNKNOWN',
        path: req.url ?? '/',
        statusCode: res.statusCode,
        latencyMs: Date.now() - startTime,
        requestSize: parseInt(getHeader(req, 'content-length'), 10) || 0,
        responseSize: getContentLength(res),
        userAgent: getHeader(req, 'user-agent'),
        ipAddress: getHeader(req, 'x-forwarded-for') || req.socket?.remoteAddress || '',
        timestamp: new Date(),
        apiVersion: req.auth?.apiVersion ?? 'v1',
        error: res.statusCode >= 400 ? `HTTP ${res.statusCode}` : undefined,
      }

      for (const handler of logHandlers) {
        try {
          handler(log)
        } catch {
          // Don't let log handler errors break the response
        }
      }
    })

    next()
  }
}


