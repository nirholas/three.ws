// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§78]

// =============================================================================
// Analytics Zod schemas
// =============================================================================

import { z } from 'zod'

export const AnalyticsSessionParamsSchema = z.object({
  id: z.string().min(1),
})

export const SentimentQuerySchema = z.object({
  speaker: z.string().optional(),
})

export const AggregateQuerySchema = z.object({
  period: z.string().regex(/^\d+d$/, 'Period must be in format "Nd" (e.g. "30d")').optional(),
})

export const TrendsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(30),
})

export const WeeklyReportQuerySchema = z.object({
  weeksBack: z.coerce.number().int().min(0).max(52).optional().default(0),
})

export const ExportQuerySchema = z.object({
  format: z.enum(['csv', 'json']).optional().default('csv'),
  period: z.string().regex(/^\d+d$/, 'Period must be in format "Nd" (e.g. "30d")').optional().default('30d'),
})


