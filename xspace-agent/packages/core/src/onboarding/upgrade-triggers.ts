// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// Upgrade Triggers — Contextual upgrade prompts based on usage and limits
// =============================================================================

import type { PlanTier, Quotas } from '../tenant/types';
import type { UpgradeTrigger, UpgradePrompt } from './types';

/** All configured upgrade triggers. */
export const UPGRADE_TRIGGERS: UpgradeTrigger[] = [
  {
    id: 'agent-limit',
    trigger: 'agent_limit_reached',
    plan: 'developer',
    message: "You've reached the 1-agent limit. Upgrade to Developer for up to 5 agents.",
    cta: 'Upgrade to Developer — $49/mo',
    location: 'modal',
    priority: 100,
  },
  {
    id: 'session-minutes-75',
    trigger: 'session_minutes_75_percent',
    plan: 'current+1',
    message: "You've used 75% of your session minutes. Upgrade for more.",
    cta: 'See plans',
    location: 'banner',
    priority: 70,
  },
  {
    id: 'session-minutes-100',
    trigger: 'session_minutes_100_percent',
    plan: 'current+1',
    message: "You've used all your session minutes for this month.",
    cta: 'Upgrade now',
    location: 'modal',
    priority: 95,
  },
  {
    id: 'team-feature',
    trigger: 'team_feature_attempted',
    plan: 'pro',
    message: 'Team collaboration requires the Pro plan.',
    cta: 'Start Pro trial',
    location: 'inline',
    priority: 80,
  },
  {
    id: 'api-rate-limit',
    trigger: 'api_rate_limit_hit',
    plan: 'current+1',
    message: 'API rate limit reached. Upgrade for higher limits.',
    cta: 'Upgrade now',
    location: 'toast',
    priority: 60,
  },
  {
    id: 'concurrent-sessions',
    trigger: 'concurrent_session_limit',
    plan: 'current+1',
    message: "You've reached the concurrent session limit for your plan.",
    cta: 'Upgrade for more sessions',
    location: 'modal',
    priority: 90,
  },
  {
    id: 'feature-gated',
    trigger: 'feature_gated',
    plan: 'current+1',
    message: 'This feature is available on a higher plan.',
    cta: 'See plans',
    location: 'inline',
    priority: 50,
  },
];

/** Plan tier ordering for resolving 'current+1'. */
const TIER_ORDER: PlanTier[] = ['free', 'developer', 'pro', 'business', 'enterprise'];

/** Resolve 'current+1' to the next plan tier. */
export function resolveNextTier(current: PlanTier): PlanTier {
  const idx = TIER_ORDER.indexOf(current);
  if (idx === -1 || idx >= TIER_ORDER.length - 1) return 'enterprise';
  return TIER_ORDER[idx + 1];
}

/** Dismissed triggers tracked per org (in-memory; migrate to DB later). */
const dismissedTriggers = new Map<string, Map<string, number>>();

/** Record that a user dismissed an upgrade prompt. */
export function dismissUpgradePrompt(orgId: string, triggerId: string): void {
  if (!dismissedTriggers.has(orgId)) {
    dismissedTriggers.set(orgId, new Map());
  }
  const orgDismissals = dismissedTriggers.get(orgId)!;
  orgDismissals.set(triggerId, (orgDismissals.get(triggerId) ?? 0) + 1);
}

/** Fire counts tracked per org (in-memory). */
const fireCounts = new Map<string, Map<string, number>>();

/**
 * Evaluate which upgrade triggers should fire given current quotas and plan.
 * Returns triggered prompts sorted by priority (highest first).
 */
export function evaluateUpgradeTriggers(
  orgId: string,
  currentPlan: PlanTier,
  quotas: Quotas,
  context?: { featureAttempted?: string; rateLimitHit?: boolean }
): UpgradePrompt[] {
  // Enterprise users never see upgrade prompts
  if (currentPlan === 'enterprise') return [];

  const results: UpgradePrompt[] = [];

  for (const trigger of UPGRADE_TRIGGERS) {
    let shouldFire = false;

    switch (trigger.trigger) {
      case 'agent_limit_reached':
        shouldFire = quotas.currentAgents >= quotas.maxAgents;
        break;
      case 'session_minutes_75_percent':
        shouldFire =
          quotas.maxSessionMinutesPerMonth !== Infinity &&
          quotas.usedSessionMinutes >= quotas.maxSessionMinutesPerMonth * 0.75 &&
          quotas.usedSessionMinutes < quotas.maxSessionMinutesPerMonth;
        break;
      case 'session_minutes_100_percent':
        shouldFire =
          quotas.maxSessionMinutesPerMonth !== Infinity &&
          quotas.usedSessionMinutes >= quotas.maxSessionMinutesPerMonth;
        break;
      case 'team_feature_attempted':
        shouldFire = context?.featureAttempted === 'team';
        break;
      case 'api_rate_limit_hit':
        shouldFire = context?.rateLimitHit === true;
        break;
      case 'concurrent_session_limit':
        shouldFire = quotas.currentSessions >= quotas.maxConcurrentSessions;
        break;
      case 'feature_gated':
        shouldFire = context?.featureAttempted != null && context.featureAttempted !== 'team';
        break;
    }

    if (shouldFire) {
      const targetPlan =
        trigger.plan === 'current+1' ? resolveNextTier(currentPlan) : trigger.plan;

      // Track fire count
      if (!fireCounts.has(orgId)) fireCounts.set(orgId, new Map());
      const orgFires = fireCounts.get(orgId)!;
      const count = (orgFires.get(trigger.id) ?? 0) + 1;
      orgFires.set(trigger.id, count);

      const orgDismissals = dismissedTriggers.get(orgId);
      const dismissed = orgDismissals?.has(trigger.id) ?? false;

      results.push({
        trigger,
        targetPlan,
        dismissed,
        fireCount: count,
      });
    }
  }

  return results.sort((a, b) => b.trigger.priority - a.trigger.priority);
}


