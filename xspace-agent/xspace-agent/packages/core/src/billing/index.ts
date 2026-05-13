// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

// =============================================================================
// Billing Module — Public Exports
// =============================================================================

export { UsageTracker, getQuotaLimit } from './usage-tracker'
export type { UsageTrackerConfig } from './usage-tracker'

export type {
  UsageMetric,
  QuotaResult,
  UsageSummary,
  UsageBreakdown,
  AlertThreshold,
} from './types'

export {
  DEFAULT_ALERT_THRESHOLDS,
  RATE_LIMITS_BY_PLAN,
  ENDPOINT_GROUP_LIMITS,
} from './types'


