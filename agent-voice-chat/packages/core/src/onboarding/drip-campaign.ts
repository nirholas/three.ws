// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§67]

// =============================================================================
// Email Drip Campaign — Automated onboarding email sequences
// =============================================================================

import type { UserId, OrgId } from '../tenant/types';
import type {
  DripEmail,
  DripEmailId,
  DripCampaignState,
  ActivationEvent,
} from './types';

/** The full drip campaign email sequence. */
export const DRIP_EMAILS: DripEmail[] = [
  {
    id: 'welcome',
    dayOffset: 0,
    subject: 'Welcome to xspace-agent! Verify your email to get started',
    condition: { type: 'always' },
    templateVars: ['userName', 'verifyUrl'],
  },
  {
    id: 'activation_reminder',
    dayOffset: 1,
    subject: 'Did you create your first agent? It only takes 2 minutes',
    condition: { type: 'activation_missing', value: 'agent_created' },
    templateVars: ['userName', 'dashboardUrl'],
  },
  {
    id: 'inspiration',
    dayOffset: 2,
    subject: "Here's what other users are building with voice agents",
    condition: { type: 'always' },
    templateVars: ['userName', 'templateGalleryUrl'],
  },
  {
    id: 'feature_discovery',
    dayOffset: 3,
    subject: 'Try multi-agent mode — run multiple AI personalities in one Space',
    condition: { type: 'always' },
    templateVars: ['userName', 'multiAgentDocsUrl'],
  },
  {
    id: 'integration_prompt',
    dayOffset: 5,
    subject: 'Connect your first webhook for real-time agent events',
    condition: { type: 'activation_missing', value: 'webhook_connected' },
    templateVars: ['userName', 'webhookDocsUrl'],
  },
  {
    id: 'week_one_summary',
    dayOffset: 7,
    subject: 'Your first week with xspace-agent — here are your stats',
    condition: { type: 'always' },
    templateVars: ['userName', 'totalSessions', 'totalMinutes', 'agentCount'],
  },
  {
    id: 'upgrade_offer',
    dayOffset: 14,
    subject: 'Unlock team features — 20% off your first month',
    condition: { type: 'plan_is', value: 'free' },
    templateVars: ['userName', 'upgradeUrl', 'discountCode'],
  },
  {
    id: 'case_study',
    dayOffset: 21,
    subject: 'Case study: How teams use voice agents for customer engagement',
    condition: { type: 'always' },
    templateVars: ['userName', 'caseStudyUrl'],
  },
  {
    id: 'trial_summary',
    dayOffset: 30,
    subject: 'Your 30-day summary + a special offer just for you',
    condition: { type: 'plan_is', value: 'free' },
    templateVars: ['userName', 'usageSummaryUrl', 'specialOfferUrl'],
  },
];

/** In-memory campaign state store (migrate to DB later). */
const campaignStates = new Map<string, DripCampaignState>();

function stateKey(userId: UserId, orgId: OrgId): string {
  return `${orgId}:${userId}`;
}

/** Enroll a user in the drip campaign. */
export function enrollInDripCampaign(userId: UserId, orgId: OrgId): DripCampaignState {
  const key = stateKey(userId, orgId);
  if (campaignStates.has(key)) {
    return campaignStates.get(key)!;
  }
  const state: DripCampaignState = {
    userId,
    orgId,
    enrolledAt: new Date(),
    sent: [],
    opened: [],
    unsubscribed: false,
  };
  campaignStates.set(key, state);
  return state;
}

/** Get the campaign state for a user. */
export function getDripCampaignState(
  userId: UserId,
  orgId: OrgId
): DripCampaignState | undefined {
  return campaignStates.get(stateKey(userId, orgId));
}

/** Unsubscribe a user from the drip campaign. */
export function unsubscribeFromDripCampaign(userId: UserId, orgId: OrgId): boolean {
  const state = campaignStates.get(stateKey(userId, orgId));
  if (!state) return false;
  state.unsubscribed = true;
  return true;
}

/** Record that a drip email was sent. */
export function recordDripEmailSent(
  userId: UserId,
  orgId: OrgId,
  emailId: DripEmailId
): void {
  const state = campaignStates.get(stateKey(userId, orgId));
  if (!state) return;
  state.sent.push({ emailId, sentAt: new Date() });
}

/** Record that a drip email was opened. */
export function recordDripEmailOpened(
  userId: UserId,
  orgId: OrgId,
  emailId: DripEmailId
): void {
  const state = campaignStates.get(stateKey(userId, orgId));
  if (!state) return;
  state.opened.push({ emailId, openedAt: new Date() });
}

/**
 * Evaluate which drip emails are due for a user.
 * Returns emails that should be sent (not yet sent and conditions met).
 */
export function evaluateDueEmails(
  userId: UserId,
  orgId: OrgId,
  context: {
    currentPlan: string;
    activationEvents: ActivationEvent[];
    now?: Date;
  }
): DripEmail[] {
  const state = campaignStates.get(stateKey(userId, orgId));
  if (!state || state.unsubscribed) return [];

  const now = context.now ?? new Date();
  const daysSinceEnrollment = Math.floor(
    (now.getTime() - state.enrolledAt.getTime()) / (1000 * 60 * 60 * 24)
  );
  const sentIds = new Set(state.sent.map((s) => s.emailId));

  return DRIP_EMAILS.filter((email) => {
    // Not yet due
    if (email.dayOffset > daysSinceEnrollment) return false;

    // Already sent
    if (sentIds.has(email.id)) return false;

    // Check condition
    if (email.condition) {
      switch (email.condition.type) {
        case 'always':
          return true;
        case 'activation_missing':
          return !context.activationEvents.includes(email.condition.value as ActivationEvent);
        case 'plan_is':
          return context.currentPlan === email.condition.value;
        case 'usage_below':
          return true; // Simplified — full implementation would check usage metrics
      }
    }

    return true;
  });
}


