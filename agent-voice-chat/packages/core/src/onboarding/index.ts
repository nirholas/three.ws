// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Onboarding & PLG Module — Public Exports
// =============================================================================

// Types
export type {
  UseCase,
  TargetPlatform,
  PersonalityArchetype,
  OnboardingStep,
  WizardAnswers,
  QuickAgentInput,
  OnboardingState,
  AgentTemplate,
  ActivationEvent,
  ActivationRecord,
  ActivationSummary,
  UpgradePromptLocation,
  UpgradeTrigger,
  UpgradePrompt,
  DripEmailId,
  DripEmail,
  DripCondition,
  DripCampaignState,
  ReferralStatus,
  Referral,
  ReferralSummary,
  AnalyticsCategory,
  AnalyticsEvent,
} from './types';

// Onboarding orchestrator
export {
  startOnboarding,
  getOnboardingState,
  completeWelcomeWizard,
  completeAgentCreation,
  setOnboardingAgentId,
  completeAgentTest,
  completeOnboarding,
  skipToStep,
  getRecommendedTemplate,
  getOnboardingProgress,
  clearOnboardingState,
} from './onboarding';

// Agent templates
export {
  AGENT_TEMPLATES,
  getTemplate,
  getTemplatesByCategory,
  getTemplatesForPlan,
  getFeaturedTemplates,
} from './templates';

// Activation tracking
export {
  ACTIVATION_EVENTS,
  trackActivation,
  getActivationRecords,
  getAchievedActivations,
  getActivationSummary,
  hasActivation,
  clearActivations,
} from './activation-tracker';

// Upgrade triggers
export {
  UPGRADE_TRIGGERS,
  resolveNextTier,
  evaluateUpgradeTriggers,
  dismissUpgradePrompt,
} from './upgrade-triggers';

// Drip campaign
export {
  DRIP_EMAILS,
  enrollInDripCampaign,
  getDripCampaignState,
  unsubscribeFromDripCampaign,
  recordDripEmailSent,
  recordDripEmailOpened,
  evaluateDueEmails,
} from './drip-campaign';

// Referral program
export {
  REFERRAL_CREDIT_CENTS,
  REFERRAL_EXPIRY_DAYS,
  getOrCreateReferralCode,
  createReferral,
  getReferralByCode,
  getReferral,
  markReferralSignedUp,
  markReferralConverted,
  applyReferralCredit,
  getUserReferrals,
  getReferralSummary,
  expireOldReferrals,
  clearReferrals,
} from './referral';

// Product analytics
export {
  registerAnalyticsHandler,
  clearAnalyticsHandlers,
  trackEvent,
  trackOnboardingStep,
  trackSignup,
  trackAgentCreated,
  trackSessionStarted,
  trackUpgrade,
  trackUpgradePromptShown,
  trackUpgradePromptDismissed,
  trackReferralShared,
  trackReferralConverted,
  getRecentEvents,
  getFunnelMetrics,
  clearEventBuffer,
} from './analytics';
export type { AnalyticsHandler } from './analytics';


