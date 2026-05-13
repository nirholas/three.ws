// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

// =============================================================================
// Plan Definitions — Subscription tiers with quotas, features, and pricing
// =============================================================================

import type { Plan, PlanTier } from './types';

/** All available subscription plans indexed by tier. */
export const PLANS: Record<PlanTier, Plan> = {
  free: {
    tier: 'free',
    maxAgents: 1,
    maxConcurrentSessions: 1,
    maxSessionMinutesPerMonth: 60,
    maxApiCallsPerMinute: 10,
    features: ['single-agent', 'basic-tts', 'basic-stt'],
    retentionDays: 7,
    support: 'community',
    price: 0,
  },
  developer: {
    tier: 'developer',
    maxAgents: 5,
    maxConcurrentSessions: 3,
    maxSessionMinutesPerMonth: 1000,
    maxApiCallsPerMinute: 100,
    features: ['single-agent', 'multi-agent', 'all-tts', 'all-stt', 'webhooks'],
    retentionDays: 30,
    support: 'email',
    price: 4900, // $49/mo base + usage
  },
  pro: {
    tier: 'pro',
    maxAgents: 25,
    maxConcurrentSessions: 10,
    maxSessionMinutesPerMonth: 10000,
    maxApiCallsPerMinute: 500,
    features: ['*', '-white-label', '-custom-sla', '-dedicated-infra'],
    retentionDays: 90,
    support: 'priority',
    price: 29900, // $299/mo base + usage
  },
  business: {
    tier: 'business',
    maxAgents: 100,
    maxConcurrentSessions: 50,
    maxSessionMinutesPerMonth: 100000,
    maxApiCallsPerMinute: 2000,
    features: ['*', '-dedicated-infra'],
    retentionDays: 365,
    support: 'dedicated',
    price: 199900, // $1,999/mo base + usage
  },
  enterprise: {
    tier: 'enterprise',
    maxAgents: Infinity,
    maxConcurrentSessions: Infinity,
    maxSessionMinutesPerMonth: Infinity,
    maxApiCallsPerMinute: 10000,
    features: ['*'],
    retentionDays: Infinity,
    support: 'dedicated-tam',
    price: null, // Custom pricing
  },
};

/** Get a plan definition by tier. Throws if tier is invalid. */
export function getPlan(tier: PlanTier): Plan {
  const plan = PLANS[tier];
  if (!plan) {
    throw new Error(`Unknown plan tier: ${tier}`);
  }
  return plan;
}

/** Get the default quotas for a plan tier. */
export function getDefaultQuotas(tier: PlanTier) {
  const plan = getPlan(tier);
  return {
    maxAgents: plan.maxAgents,
    currentAgents: 0,
    maxConcurrentSessions: plan.maxConcurrentSessions,
    currentSessions: 0,
    maxSessionMinutesPerMonth: plan.maxSessionMinutesPerMonth,
    usedSessionMinutes: 0,
    maxApiCallsPerMinute: plan.maxApiCallsPerMinute,
  };
}


