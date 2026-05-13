// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// Managed Hosting Platform — defineConfig Helper
// =============================================================================

import type { HostedAgentConfig, ScalingConfig } from './types'
import { DEFAULT_SCALING_CONFIG } from './types'

/**
 * Helper for authoring `xspace.config.ts` with full type safety.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'xspace-agent';
 *
 * export default defineConfig({
 *   name: 'support-agent',
 *   version: '1.0.0',
 *   personality: {
 *     name: 'Alex',
 *     systemPrompt: 'You are a helpful support agent...',
 *     voice: 'nova',
 *   },
 *   providers: {
 *     llm: { provider: 'openai', model: 'gpt-4o' },
 *     stt: { provider: 'groq', model: 'whisper-large-v3' },
 *     tts: { provider: 'openai', voice: 'nova' },
 *   },
 *   scaling: { minInstances: 0, maxInstances: 5, idleTimeoutMinutes: 30 },
 * });
 * ```
 */
export function defineConfig(config: HostedAgentConfig): HostedAgentConfig {
  return {
    ...config,
    scaling: mergeScaling(config.scaling),
  }
}

function mergeScaling(scaling?: ScalingConfig): Required<ScalingConfig> {
  return {
    ...DEFAULT_SCALING_CONFIG,
    ...scaling,
  }
}

/**
 * Validate a hosted agent config. Returns an array of error messages (empty = valid).
 */
export function validateHostedConfig(config: unknown): string[] {
  const errors: string[] = []

  if (!config || typeof config !== 'object') {
    return ['Config must be a non-null object']
  }

  const c = config as Record<string, unknown>

  if (typeof c.name !== 'string' || c.name.length === 0) {
    errors.push('name is required and must be a non-empty string')
  }

  if (typeof c.version !== 'string' || c.version.length === 0) {
    errors.push('version is required and must be a non-empty string')
  }

  // Personality
  if (!c.personality || typeof c.personality !== 'object') {
    errors.push('personality is required')
  } else {
    const p = c.personality as Record<string, unknown>
    if (typeof p.name !== 'string' || p.name.length === 0) {
      errors.push('personality.name is required')
    }
    if (typeof p.systemPrompt !== 'string' || p.systemPrompt.length === 0) {
      errors.push('personality.systemPrompt is required')
    }
  }

  // Providers
  if (!c.providers || typeof c.providers !== 'object') {
    errors.push('providers is required')
  } else {
    const prov = c.providers as Record<string, unknown>
    if (!prov.llm || typeof prov.llm !== 'object') {
      errors.push('providers.llm is required')
    } else {
      const llm = prov.llm as Record<string, unknown>
      if (typeof llm.provider !== 'string') errors.push('providers.llm.provider is required')
      if (typeof llm.model !== 'string') errors.push('providers.llm.model is required')
    }
  }

  // Scaling bounds
  if (c.scaling && typeof c.scaling === 'object') {
    const s = c.scaling as Record<string, unknown>
    if (s.minInstances !== undefined && (typeof s.minInstances !== 'number' || s.minInstances < 0)) {
      errors.push('scaling.minInstances must be >= 0')
    }
    if (s.maxInstances !== undefined && (typeof s.maxInstances !== 'number' || s.maxInstances < 1)) {
      errors.push('scaling.maxInstances must be >= 1')
    }
    if (
      typeof s.minInstances === 'number' &&
      typeof s.maxInstances === 'number' &&
      s.minInstances > s.maxInstances
    ) {
      errors.push('scaling.minInstances must be <= scaling.maxInstances')
    }
    if (s.idleTimeoutMinutes !== undefined && (typeof s.idleTimeoutMinutes !== 'number' || s.idleTimeoutMinutes < 1)) {
      errors.push('scaling.idleTimeoutMinutes must be >= 1')
    }
  }

  return errors
}


