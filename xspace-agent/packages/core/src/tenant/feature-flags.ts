// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§68]

// =============================================================================
// Feature Flags — Plan-based feature gating
// =============================================================================

import type { FeatureFlags } from './types';

/**
 * All known features in the system.
 * Wildcard '*' in a plan's feature list means "all features".
 * Prefix '-' means "exclude this feature" (e.g., '-white-label').
 */
const ALL_FEATURES = [
  'single-agent',
  'multi-agent',
  'basic-tts',
  'basic-stt',
  'all-tts',
  'all-stt',
  'webhooks',
  'white-label',
  'custom-sla',
  'dedicated-infra',
  'custom-domains',
  'sso',
  'audit-log',
  'priority-routing',
  'advanced-analytics',
] as const;

export type FeatureName = (typeof ALL_FEATURES)[number];

/**
 * Create a FeatureFlags instance from a plan's feature list.
 *
 * Supports:
 * - Explicit feature names: ['single-agent', 'basic-tts']
 * - Wildcard: ['*'] means all features
 * - Exclusions: ['*', '-white-label'] means all except white-label
 */
export function createFeatureFlags(planFeatures: string[]): FeatureFlags {
  const resolved = new Set<string>();

  const hasWildcard = planFeatures.includes('*');
  const exclusions = new Set(
    planFeatures
      .filter((f) => f.startsWith('-'))
      .map((f) => f.slice(1)),
  );

  if (hasWildcard) {
    for (const feature of ALL_FEATURES) {
      if (!exclusions.has(feature)) {
        resolved.add(feature);
      }
    }
  } else {
    for (const feature of planFeatures) {
      if (!feature.startsWith('-')) {
        resolved.add(feature);
      }
    }
  }

  return {
    isEnabled(feature: string): boolean {
      return resolved.has(feature);
    },
    enabled(): string[] {
      return [...resolved];
    },
  };
}


