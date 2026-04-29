// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Onboarding & PLG Types — Self-Serve Funnel, Templates, Activation, Referrals
// =============================================================================

import type { OrgId, UserId, PlanTier } from '../tenant/types';

// ---------------------------------------------------------------------------
// Onboarding Wizard
// ---------------------------------------------------------------------------

/** Use case categories for onboarding personalization. */
export type UseCase =
  | 'customer_support'
  | 'content_creation'
  | 'market_research'
  | 'community_engagement'
  | 'other';

/** Target platform for the agent. */
export type TargetPlatform =
  | 'x_spaces'
  | 'website_widget'
  | 'discord'
  | 'custom_integration';

/** Agent personality archetype for quick-start. */
export type PersonalityArchetype =
  | 'professional'
  | 'friendly'
  | 'authoritative'
  | 'creative'
  | 'analytical';

/** Onboarding wizard step identifiers. */
export type OnboardingStep =
  | 'signup'
  | 'welcome_wizard'
  | 'create_agent'
  | 'test_agent'
  | 'deploy'
  | 'complete';

/** Wizard answers from the welcome step. */
export interface WizardAnswers {
  /** Primary use case. */
  useCase: UseCase;
  /** Custom use case description (when useCase is 'other'). */
  customUseCase?: string;
  /** Target platform for first agent. */
  platform: TargetPlatform;
}

/** First agent creation input from the wizard. */
export interface QuickAgentInput {
  /** Agent display name. */
  name: string;
  /** Personality archetype. */
  personality: PersonalityArchetype;
  /** Voice ID to use for TTS. */
  voiceId: string;
  /** Template ID to base the agent on (optional). */
  templateId?: string;
}

/** Tracks a user's progress through the onboarding funnel. */
export interface OnboardingState {
  /** User ID. */
  userId: UserId;
  /** Organization ID. */
  orgId: OrgId;
  /** Current step in the wizard. */
  currentStep: OnboardingStep;
  /** Wizard answers (set after welcome_wizard step). */
  wizardAnswers?: WizardAnswers;
  /** Agent created during onboarding (set after create_agent step). */
  agentId?: string;
  /** Whether onboarding is complete. */
  completed: boolean;
  /** When onboarding started. */
  startedAt: Date;
  /** When each step was completed. */
  stepCompletedAt: Partial<Record<OnboardingStep, Date>>;
  /** When onboarding was fully completed. */
  completedAt?: Date;
}

// ---------------------------------------------------------------------------
// Agent Templates
// ---------------------------------------------------------------------------

/** A pre-built agent template. */
export interface AgentTemplate {
  /** Unique template ID. */
  id: string;
  /** Display name. */
  name: string;
  /** Short description. */
  description: string;
  /** Category tag. */
  category: UseCase | 'general';
  /** Recommended platform. */
  platform: TargetPlatform;
  /** System prompt for the agent. */
  systemPrompt: string;
  /** Personality archetype. */
  personality: PersonalityArchetype;
  /** Suggested voice ID. */
  suggestedVoiceId: string;
  /** Agent behavior configuration overrides. */
  behaviorOverrides: Record<string, unknown>;
  /** Icon/emoji for display. */
  icon: string;
  /** Whether this is a featured/promoted template. */
  featured: boolean;
  /** Minimum plan required to use this template. */
  minPlan: PlanTier;
}

// ---------------------------------------------------------------------------
// Activation Tracking
// ---------------------------------------------------------------------------

/** Activation events that correlate with conversion. */
export type ActivationEvent =
  | 'agent_created'
  | 'first_session_completed'
  | 'agent_first_spoke'
  | 'teammate_invited'
  | 'webhook_connected'
  | 'session_30_minutes';

/** Record of a tracked activation event. */
export interface ActivationRecord {
  /** Event type. */
  event: ActivationEvent;
  /** User who triggered the event. */
  userId: UserId;
  /** Organization. */
  orgId: OrgId;
  /** When the event occurred. */
  occurredAt: Date;
  /** Additional metadata. */
  metadata?: Record<string, unknown>;
}

/** Activation summary for a user/org. */
export interface ActivationSummary {
  /** Organization ID. */
  orgId: OrgId;
  /** Events that have been achieved. */
  achieved: ActivationEvent[];
  /** Events not yet achieved. */
  pending: ActivationEvent[];
  /** Percentage of activation events completed (0-100). */
  score: number;
  /** Time from signup to first activation event. */
  timeToFirstActivation?: number;
}

// ---------------------------------------------------------------------------
// Upgrade Triggers
// ---------------------------------------------------------------------------

/** Where upgrade prompts can be displayed. */
export type UpgradePromptLocation = 'modal' | 'banner' | 'inline' | 'toast';

/** A trigger condition for showing an upgrade prompt. */
export interface UpgradeTrigger {
  /** Unique trigger identifier. */
  id: string;
  /** What condition fires this trigger. */
  trigger:
    | 'agent_limit_reached'
    | 'session_minutes_75_percent'
    | 'session_minutes_100_percent'
    | 'team_feature_attempted'
    | 'api_rate_limit_hit'
    | 'concurrent_session_limit'
    | 'feature_gated'
    | 'storage_limit_reached';
  /** Target plan to suggest (or 'current+1' for next tier). */
  plan: PlanTier | 'current+1';
  /** User-facing message. */
  message: string;
  /** Call-to-action button text. */
  cta: string;
  /** Where to show the prompt. */
  location: UpgradePromptLocation;
  /** Priority (higher = more important, shows first). */
  priority: number;
}

/** Result of evaluating upgrade triggers for a user. */
export interface UpgradePrompt {
  /** The trigger that fired. */
  trigger: UpgradeTrigger;
  /** Resolved target plan tier. */
  targetPlan: PlanTier;
  /** Whether this prompt has been dismissed before. */
  dismissed: boolean;
  /** Number of times this trigger has fired for this user. */
  fireCount: number;
}

// ---------------------------------------------------------------------------
// Email Drip Campaign
// ---------------------------------------------------------------------------

/** Email template identifiers for the drip campaign. */
export type DripEmailId =
  | 'welcome'
  | 'activation_reminder'
  | 'inspiration'
  | 'feature_discovery'
  | 'integration_prompt'
  | 'week_one_summary'
  | 'upgrade_offer'
  | 'case_study'
  | 'trial_summary';

/** A scheduled drip email. */
export interface DripEmail {
  /** Email identifier. */
  id: DripEmailId;
  /** Days after signup to send. */
  dayOffset: number;
  /** Email subject line. */
  subject: string;
  /** Whether this email is conditional on user state. */
  condition?: DripCondition;
  /** Template variables to inject. */
  templateVars: string[];
}

/** Condition for sending a drip email. */
export interface DripCondition {
  /** Type of condition. */
  type: 'activation_missing' | 'plan_is' | 'usage_below' | 'always';
  /** Condition value (e.g., activation event name, plan tier). */
  value?: string;
}

/** State of the drip campaign for a user. */
export interface DripCampaignState {
  /** User ID. */
  userId: UserId;
  /** Organization ID. */
  orgId: OrgId;
  /** When the user signed up (campaign start). */
  enrolledAt: Date;
  /** Emails that have been sent. */
  sent: Array<{ emailId: DripEmailId; sentAt: Date }>;
  /** Emails the user has opened. */
  opened: Array<{ emailId: DripEmailId; openedAt: Date }>;
  /** Whether the user has unsubscribed. */
  unsubscribed: boolean;
}

// ---------------------------------------------------------------------------
// Referral Program
// ---------------------------------------------------------------------------

/** Status of a referral. */
export type ReferralStatus = 'pending' | 'signed_up' | 'converted' | 'expired';

/** A referral record. */
export interface Referral {
  /** Unique referral ID. */
  id: string;
  /** User who made the referral. */
  referrerId: UserId;
  /** Referrer's organization. */
  referrerOrgId: OrgId;
  /** Unique referral code. */
  code: string;
  /** Email of the referred person (if known). */
  referredEmail?: string;
  /** User ID of the referred person (after signup). */
  referredUserId?: UserId;
  /** Organization of the referred person (after signup). */
  referredOrgId?: OrgId;
  /** Current status. */
  status: ReferralStatus;
  /** Credit amount in cents earned by the referrer. */
  creditCents: number;
  /** Whether the credit has been applied. */
  creditApplied: boolean;
  /** When the referral was created. */
  createdAt: Date;
  /** When the referred user signed up. */
  signedUpAt?: Date;
  /** When the referred user converted to paid. */
  convertedAt?: Date;
}

/** Referral summary for a user. */
export interface ReferralSummary {
  /** User ID. */
  userId: UserId;
  /** Unique referral code for this user. */
  referralCode: string;
  /** Total referrals made. */
  totalReferrals: number;
  /** Referrals that converted to paid. */
  conversions: number;
  /** Total credits earned in cents. */
  totalCreditsCents: number;
  /** Credits pending (not yet applied). */
  pendingCreditsCents: number;
}

// ---------------------------------------------------------------------------
// Product Analytics Events
// ---------------------------------------------------------------------------

/** Analytics event categories. */
export type AnalyticsCategory =
  | 'onboarding'
  | 'activation'
  | 'engagement'
  | 'conversion'
  | 'referral'
  | 'retention';

/** A product analytics event. */
export interface AnalyticsEvent {
  /** Event name (e.g., 'onboarding.step_completed'). */
  name: string;
  /** Category for grouping. */
  category: AnalyticsCategory;
  /** User who triggered the event. */
  userId?: UserId;
  /** Organization. */
  orgId?: OrgId;
  /** Event properties. */
  properties: Record<string, unknown>;
  /** Timestamp. */
  timestamp: Date;
}


