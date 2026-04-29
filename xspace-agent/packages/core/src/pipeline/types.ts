// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§88]

// =============================================================================
// Pipeline – Provider Interfaces (re-exported from canonical types)
// =============================================================================

export type {
  LLMProvider,
  STTProvider,
  TTSProvider,
  CustomProvider,
  ProviderMetrics,
} from '../types'

/** @deprecated Use CustomProvider from '../types' instead. */
export type { CustomProvider as CustomProviderInterface } from '../types'


