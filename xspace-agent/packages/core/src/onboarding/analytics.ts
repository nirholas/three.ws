// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§78]

// =============================================================================
// Product Analytics — Event tracking for PLG funnel metrics
// =============================================================================

import type { OrgId, UserId } from '../tenant/types';
import type { AnalyticsCategory, AnalyticsEvent, OnboardingStep } from './types';

/** Analytics event handler callback. */
export type AnalyticsHandler = (event: AnalyticsEvent) => void;

/** Registered external analytics handlers (e.g., Segment, PostHog). */
const handlers: AnalyticsHandler[] = [];

/** In-memory event buffer for recent events. */
const eventBuffer: AnalyticsEvent[] = [];
const MAX_BUFFER_SIZE = 10000;

/** Register an analytics handler (e.g., for Segment, PostHog, Mixpanel). */
export function registerAnalyticsHandler(handler: AnalyticsHandler): void {
  handlers.push(handler);
}

/** Remove all registered analytics handlers. */
export function clearAnalyticsHandlers(): void {
  handlers.length = 0;
}

/** Track a raw analytics event. */
export function trackEvent(
  name: string,
  category: AnalyticsCategory,
  properties: Record<string, unknown> = {},
  userId?: UserId,
  orgId?: OrgId
): AnalyticsEvent {
  const event: AnalyticsEvent = {
    name,
    category,
    userId,
    orgId,
    properties,
    timestamp: new Date(),
  };

  // Buffer locally
  eventBuffer.push(event);
  if (eventBuffer.length > MAX_BUFFER_SIZE) {
    eventBuffer.splice(0, eventBuffer.length - MAX_BUFFER_SIZE);
  }

  // Forward to registered handlers
  for (const handler of handlers) {
    try {
      handler(event);
    } catch {
      // Silently ignore handler errors to prevent analytics from breaking app
    }
  }

  return event;
}

// ---------------------------------------------------------------------------
// Pre-built event tracking helpers
// ---------------------------------------------------------------------------

/** Track an onboarding step completion. */
export function trackOnboardingStep(
  step: OnboardingStep,
  userId: UserId,
  orgId: OrgId,
  durationMs?: number
): AnalyticsEvent {
  return trackEvent(
    `onboarding.${step}_completed`,
    'onboarding',
    { step, durationMs },
    userId,
    orgId
  );
}

/** Track a signup event. */
export function trackSignup(
  userId: UserId,
  orgId: OrgId,
  method: 'email' | 'google' | 'github',
  referralCode?: string
): AnalyticsEvent {
  return trackEvent(
    'onboarding.signup',
    'onboarding',
    { method, referralCode },
    userId,
    orgId
  );
}

/** Track agent creation. */
export function trackAgentCreated(
  userId: UserId,
  orgId: OrgId,
  agentId: string,
  templateId?: string
): AnalyticsEvent {
  return trackEvent(
    'activation.agent_created',
    'activation',
    { agentId, templateId, fromTemplate: !!templateId },
    userId,
    orgId
  );
}

/** Track a session start. */
export function trackSessionStarted(
  userId: UserId,
  orgId: OrgId,
  agentId: string,
  sessionType: 'browser_test' | 'x_spaces' | 'widget' | 'api'
): AnalyticsEvent {
  return trackEvent(
    'engagement.session_started',
    'engagement',
    { agentId, sessionType },
    userId,
    orgId
  );
}

/** Track a plan upgrade. */
export function trackUpgrade(
  userId: UserId,
  orgId: OrgId,
  fromPlan: string,
  toPlan: string,
  triggerId?: string
): AnalyticsEvent {
  return trackEvent(
    'conversion.plan_upgraded',
    'conversion',
    { fromPlan, toPlan, triggerId },
    userId,
    orgId
  );
}

/** Track an upgrade prompt being shown. */
export function trackUpgradePromptShown(
  userId: UserId,
  orgId: OrgId,
  triggerId: string,
  targetPlan: string
): AnalyticsEvent {
  return trackEvent(
    'conversion.upgrade_prompt_shown',
    'conversion',
    { triggerId, targetPlan },
    userId,
    orgId
  );
}

/** Track an upgrade prompt being dismissed. */
export function trackUpgradePromptDismissed(
  userId: UserId,
  orgId: OrgId,
  triggerId: string
): AnalyticsEvent {
  return trackEvent(
    'conversion.upgrade_prompt_dismissed',
    'conversion',
    { triggerId },
    userId,
    orgId
  );
}

/** Track a referral link share. */
export function trackReferralShared(
  userId: UserId,
  orgId: OrgId,
  referralCode: string
): AnalyticsEvent {
  return trackEvent(
    'referral.link_shared',
    'referral',
    { referralCode },
    userId,
    orgId
  );
}

/** Track a referral conversion. */
export function trackReferralConverted(
  referrerId: UserId,
  referrerOrgId: OrgId,
  referredOrgId: OrgId
): AnalyticsEvent {
  return trackEvent(
    'referral.converted',
    'referral',
    { referredOrgId },
    referrerId,
    referrerOrgId
  );
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/** Get recent events from the buffer, optionally filtered. */
export function getRecentEvents(filter?: {
  category?: AnalyticsCategory;
  userId?: UserId;
  orgId?: OrgId;
  limit?: number;
}): AnalyticsEvent[] {
  let events = [...eventBuffer];

  if (filter?.category) {
    events = events.filter((e) => e.category === filter.category);
  }
  if (filter?.userId) {
    events = events.filter((e) => e.userId === filter.userId);
  }
  if (filter?.orgId) {
    events = events.filter((e) => e.orgId === filter.orgId);
  }

  // Most recent first
  events.reverse();

  if (filter?.limit) {
    events = events.slice(0, filter.limit);
  }

  return events;
}

/** Get funnel conversion metrics for a time period. */
export function getFunnelMetrics(
  startDate: Date,
  endDate: Date
): {
  signups: number;
  agentCreated: number;
  sessionCompleted: number;
  upgraded: number;
  signupToAgentRate: number;
  agentToSessionRate: number;
  sessionToUpgradeRate: number;
} {
  const periodEvents = eventBuffer.filter(
    (e) => e.timestamp >= startDate && e.timestamp <= endDate
  );

  const signups = periodEvents.filter((e) => e.name === 'onboarding.signup').length;
  const agentCreated = periodEvents.filter((e) => e.name === 'activation.agent_created').length;
  const sessionCompleted = periodEvents.filter((e) => e.name === 'engagement.session_started').length;
  const upgraded = periodEvents.filter((e) => e.name === 'conversion.plan_upgraded').length;

  return {
    signups,
    agentCreated,
    sessionCompleted,
    upgraded,
    signupToAgentRate: signups > 0 ? agentCreated / signups : 0,
    agentToSessionRate: agentCreated > 0 ? sessionCompleted / agentCreated : 0,
    sessionToUpgradeRate: sessionCompleted > 0 ? upgraded / sessionCompleted : 0,
  };
}

/** Clear the event buffer (for testing). */
export function clearEventBuffer(): void {
  eventBuffer.length = 0;
}


