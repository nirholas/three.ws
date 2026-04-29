// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§78]

// =============================================================================
// Personality Zod schemas
// =============================================================================

import { z } from 'zod'

export const CreatePersonalityBodySchema = z.object({
  id: z.string().min(1, 'id is required'),
  name: z.string().min(1, 'name is required'),
  systemPrompt: z.string().min(1, 'systemPrompt is required'),
  description: z.string().optional(),
  context: z.array(z.string()).optional(),
  behavior: z.object({
    temperature: z.number().min(0).max(2).optional(),
    maxResponseTokens: z.number().int().positive().optional(),
  }).optional(),
  voice: z.object({
    provider: z.string(),
    voiceId: z.string().optional(),
    speed: z.number().optional(),
    stability: z.number().optional(),
  }).optional(),
})

export const UpdatePersonalityBodySchema = CreatePersonalityBodySchema.partial()


