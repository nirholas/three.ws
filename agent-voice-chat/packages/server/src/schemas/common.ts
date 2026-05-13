// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Common Zod schemas shared across API endpoints
// =============================================================================

import { z } from 'zod'

/** UUID or generic string ID parameter. */
export const IdParamSchema = z.object({
  id: z.string().min(1, 'ID is required'),
})

/** Agent ID param (0 or 1 for this server). */
export const AgentIdParamSchema = z.object({
  agentId: z.string().refine(
    (v) => { const n = parseInt(v, 10); return !isNaN(n) && n >= 0 && n <= 1 },
    { message: 'Agent ID must be 0 or 1' },
  ),
})

/** Pagination query parameters. */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
})

/** Slug parameter (URL-safe string). */
export const SlugParamSchema = z.object({
  slug: z.string().min(1).max(200),
})

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


