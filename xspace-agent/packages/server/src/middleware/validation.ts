// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

// =============================================================================
// Input validation schemas and middleware
// rev:CEVFZ-2026
// =============================================================================

import { z, type ZodSchema, ZodError } from 'zod'
import type { Request, Response, NextFunction } from 'express'
import { buildErrorResponse } from './error-handler'

// ---------------------------------------------------------------------------
// Reusable Express validation middleware
// ---------------------------------------------------------------------------

/**
 * Creates an Express middleware that validates `req[source]` against the given
 * Zod schema. On success the parsed (and potentially transformed/defaulted)
 * data is written to `req.validated`. On failure a standardised 400 response
 * is returned.
 */
export function validate(
  schema: ZodSchema,
  source: 'body' | 'query' | 'params' = 'body',
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source])
    if (!result.success) {
      const requestId = (req as any).id as string | undefined
      res.status(400).json(
        buildErrorResponse('VALIDATION_ERROR', 'Invalid request', {
          details: result.error.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
          })),
          hint: `Check the ${source} of your request`,
          requestId,
        }),
      )
      return
    }
    ;(req as any).validated = result.data
    next()
  }
}

// ---------------------------------------------------------------------------
// Space URL schema (re-exported from schemas for backwards compat)
// ---------------------------------------------------------------------------

/** Validates that a string is a genuine X/Twitter Space URL. */
export const SpaceUrlSchema = z
  .string()
  .url()
  .refine(
    (url) => {
      try {
        const parsed = new URL(url)
        return (
          (parsed.hostname === 'x.com' || parsed.hostname === 'twitter.com') &&
          /\/i\/spaces\/[A-Za-z0-9]+/.test(parsed.pathname)
        )
      } catch {
        return false
      }
    },
    { message: 'Must be a valid X Space URL (https://x.com/i/spaces/...)' },
  )

// ---------------------------------------------------------------------------
// Socket.IO event schemas
// ---------------------------------------------------------------------------

/** Schemas keyed by Socket.IO event name. */
export const SocketEventSchemas: Record<string, z.ZodTypeAny> = {
  'xspace:start': z.object({ spaceUrl: SpaceUrlSchema, listenOnly: z.boolean().optional() }),
  'xspace:join': z.object({ spaceUrl: SpaceUrlSchema }),
  'xspace:join-listener': z.object({ spaceUrl: SpaceUrlSchema }),
  'xspace:2fa': z.object({
    code: z.string().regex(/^\d{6,8}$/, 'Must be a 6-8 digit code'),
  }),
  'admin:override-selector': z.object({
    name: z.string().min(1).max(100),
    selector: z.string().min(1).max(500),
  }),
  'orchestrator:force-speak': z.object({
    botId: z.string().min(1).max(100),
  }),
  'xspace:message': z.object({
    text: z.string().min(1).max(2000),
  }),
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface ValidationResult<T = unknown> {
  valid: boolean
  error?: string
  data?: T
}

/**
 * Validate a Socket.IO event payload against the matching schema.
 * Events without a registered schema pass through unchanged.
 */
export function validateSocketEvent(
  eventName: string,
  data: unknown,
): ValidationResult {
  const schema = SocketEventSchemas[eventName]
  if (!schema) return { valid: true, data }

  const result = schema.safeParse(data)
  if (!result.success) {
    return {
      valid: false,
      error: result.error.issues.map((i) => i.message).join(', '),
    }
  }
  return { valid: true, data: result.data }
}


