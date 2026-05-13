// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§68]

// =============================================================================
// Provider Registry – Re-exports
// =============================================================================

export { createLLM } from '../pipeline/llm'
export { createSTT } from '../pipeline/stt'
export { createTTS, createTTSWithFallback } from '../pipeline/tts'
export type {
  LLMProvider,
  STTProvider,
  TTSProvider,
  CustomProviderInterface,
} from '../pipeline/types'

// Provider intelligence
export { ProviderRouter } from './router'
export { CostTracker } from './cost-tracker'
export { ProviderHealthMonitor } from './health-monitor'
export type {
  RoutableProvider,
  RoutingStrategy,
  RoutingPriority,
  RouterConfig,
  ProviderStatus,
  HealthCheckResult,
  CostEntry,
  CostSummary,
} from './types'
export type { HealthEvent, HealthEventHandler } from './health-monitor'


