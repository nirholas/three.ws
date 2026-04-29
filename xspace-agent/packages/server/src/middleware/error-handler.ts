// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// Standardized error handling middleware
// =============================================================================

import type { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { XSpaceError, redactSecrets } from 'xspace-agent'
import { getAppLogger } from 'xspace-agent'

// ---------------------------------------------------------------------------
// Error codes → HTTP status mapping
// ---------------------------------------------------------------------------

const ERROR_CODE_STATUS: Record<string, number> = {
  VALIDATION_ERROR: 400,
  AUTH_REQUIRED: 401,
  AUTH_INVALID: 401,
  AUTH_FAILED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SPACE_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  PROVIDER_ERROR: 502,
  INTERNAL_ERROR: 500,
  CONFIG_INVALID: 400,
  BROWSER_CONNECTION: 503,
  SELECTOR_BROKEN: 503,
  SPEAKER_DENIED: 403,
  SPACE_ENDED: 410,
}

// ---------------------------------------------------------------------------
// Standard error response shape
// ---------------------------------------------------------------------------

export interface ApiErrorDetail {
  field: string
  message: string
}

export interface ApiErrorResponse {
  error: {
    code: string
    message: string
    details?: ApiErrorDetail[]
    hint?: string
    docsUrl?: string
    requestId?: string
  }
}

// ---------------------------------------------------------------------------
// Helper to build a standardized error response
// ---------------------------------------------------------------------------

export function buildErrorResponse(
  code: string,
  message: string,
  opts?: {
    details?: ApiErrorDetail[]
    hint?: string
    docsUrl?: string
    requestId?: string
  },
): ApiErrorResponse {
  return {
    error: {
      code,
      message,
      ...(opts?.details?.length && { details: opts.details }),
      ...(opts?.hint && { hint: opts.hint }),
      ...(opts?.docsUrl && { docsUrl: opts.docsUrl }),
      ...(opts?.requestId && { requestId: opts.requestId }),
    },
  }
}

// ---------------------------------------------------------------------------
// Global Express error handler — must be registered last
// ---------------------------------------------------------------------------

export function globalErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (req as any).id as string | undefined
  const log = (req as any).log ?? getAppLogger('error-handler')

  // --- Zod validation errors ---
  if (err instanceof ZodError) {
    res.status(400).json(
      buildErrorResponse('VALIDATION_ERROR', 'Invalid request', {
        details: err.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
        requestId,
      }),
    )
    return
  }

  // --- XSpaceError hierarchy ---
  if (err instanceof XSpaceError) {
    const code = (err as any).code as string
    const hint = (err as any).hint as string | undefined
    const docsUrl = (err as any).docsUrl as string | undefined
    const status = ERROR_CODE_STATUS[code] ?? 500
    res.status(status).json(
      buildErrorResponse(code, err.message, {
        hint,
        docsUrl,
        requestId,
      }),
    )
    return
  }

  // --- Unexpected errors ---
  log.error({ err, path: req.path, method: req.method }, 'unhandled error')

  const message =
    process.env.NODE_ENV === 'production'
      ? 'Something went wrong'
      : redactSecrets(err.message)

  res.status(500).json(
    buildErrorResponse('INTERNAL_ERROR', message, { requestId }),
  )
}


