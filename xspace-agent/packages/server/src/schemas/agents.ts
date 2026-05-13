// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

// =============================================================================
// Agent-related Zod schemas
// =============================================================================

import { z } from 'zod'

export const SetPersonalityBodySchema = z.object({
  personalityId: z.string().min(1, 'personalityId is required'),
  clearHistory: z.boolean().optional(),
})

export const OverrideSelectorParamsSchema = z.object({
  name: z.string().min(1).max(100, 'Selector name too long (max 100 chars)'),
})

export const OverrideSelectorBodySchema = z.object({
  selector: z.string().min(1).max(500, 'Selector value too long (max 500 chars)'),
})

export const CostQuerySchema = z.object({
  since: z.coerce.number().int().positive().optional(),
})


