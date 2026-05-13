// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

// =============================================================================
// Onboarding Orchestrator — Manages the self-serve signup → first-agent flow
// =============================================================================

import type { OrgId, UserId } from '../tenant/types';
import type {
  OnboardingState,
  OnboardingStep,
  WizardAnswers,
  QuickAgentInput,
} from './types';
import { trackOnboardingStep, trackSignup, trackAgentCreated } from './analytics';
import { enrollInDripCampaign } from './drip-campaign';
import { trackActivation } from './activation-tracker';
import { getTemplate, AGENT_TEMPLATES } from './templates';

/** In-memory onboarding state store (migrate to DB later). */
const onboardingStates = new Map<string, OnboardingState>();

function stateKey(userId: UserId, orgId: OrgId): string {
  return `${orgId}:${userId}`;
}

/** Step ordering for progression validation. */
const STEP_ORDER: OnboardingStep[] = [
  'signup',
  'welcome_wizard',
  'create_agent',
  'test_agent',
  'deploy',
  'complete',
];

/**
 * Start onboarding for a new user/org.
 * Called after signup completes.
 */
export function startOnboarding(
  userId: UserId,
  orgId: OrgId,
  signupMethod: 'email' | 'google' | 'github',
  referralCode?: string
): OnboardingState {
  const key = stateKey(userId, orgId);

  // Idempotent — return existing if already started
  if (onboardingStates.has(key)) {
    return onboardingStates.get(key)!;
  }

  const state: OnboardingState = {
    userId,
    orgId,
    currentStep: 'signup',
    completed: false,
    startedAt: new Date(),
    stepCompletedAt: {},
  };

  onboardingStates.set(key, state);

  // Mark signup step as immediately complete
  state.stepCompletedAt.signup = new Date();
  state.currentStep = 'welcome_wizard';

  // Track analytics
  trackSignup(userId, orgId, signupMethod, referralCode);
  trackOnboardingStep('signup', userId, orgId);

  // Enroll in drip campaign
  enrollInDripCampaign(userId, orgId);

  return state;
}

/** Get current onboarding state. */
export function getOnboardingState(
  userId: UserId,
  orgId: OrgId
): OnboardingState | undefined {
  return onboardingStates.get(stateKey(userId, orgId));
}

/** Complete the welcome wizard step. */
export function completeWelcomeWizard(
  userId: UserId,
  orgId: OrgId,
  answers: WizardAnswers
): OnboardingState | undefined {
  const state = onboardingStates.get(stateKey(userId, orgId));
  if (!state || state.currentStep !== 'welcome_wizard') return undefined;

  state.wizardAnswers = answers;
  state.stepCompletedAt.welcome_wizard = new Date();
  state.currentStep = 'create_agent';

  trackOnboardingStep('welcome_wizard', userId, orgId);
  return state;
}

/**
 * Complete the create-agent step.
 * Returns the recommended template based on wizard answers, or the agent config to create.
 */
export function completeAgentCreation(
  userId: UserId,
  orgId: OrgId,
  input: QuickAgentInput
): OnboardingState | undefined {
  const state = onboardingStates.get(stateKey(userId, orgId));
  if (!state || state.currentStep !== 'create_agent') return undefined;

  // Track agent creation (agentId will be set by the caller after actual creation)
  state.stepCompletedAt.create_agent = new Date();
  state.currentStep = 'test_agent';

  trackOnboardingStep('create_agent', userId, orgId);
  trackAgentCreated(userId, orgId, input.name, input.templateId);
  trackActivation('agent_created', userId, orgId, {
    templateId: input.templateId,
    personality: input.personality,
  });

  return state;
}

/** Set the agent ID created during onboarding. */
export function setOnboardingAgentId(
  userId: UserId,
  orgId: OrgId,
  agentId: string
): void {
  const state = onboardingStates.get(stateKey(userId, orgId));
  if (state) {
    state.agentId = agentId;
  }
}

/** Complete the test-agent step. */
export function completeAgentTest(
  userId: UserId,
  orgId: OrgId
): OnboardingState | undefined {
  const state = onboardingStates.get(stateKey(userId, orgId));
  if (!state || state.currentStep !== 'test_agent') return undefined;

  state.stepCompletedAt.test_agent = new Date();
  state.currentStep = 'deploy';

  trackOnboardingStep('test_agent', userId, orgId);
  trackActivation('first_session_completed', userId, orgId);

  return state;
}

/** Complete the deploy step and finish onboarding. */
export function completeOnboarding(
  userId: UserId,
  orgId: OrgId
): OnboardingState | undefined {
  const state = onboardingStates.get(stateKey(userId, orgId));
  if (!state || state.completed) return undefined;

  state.stepCompletedAt.deploy = new Date();
  state.stepCompletedAt.complete = new Date();
  state.currentStep = 'complete';
  state.completed = true;
  state.completedAt = new Date();

  const totalDuration = state.completedAt.getTime() - state.startedAt.getTime();
  trackOnboardingStep('deploy', userId, orgId);
  trackOnboardingStep('complete', userId, orgId, totalDuration);

  return state;
}

/** Skip to a specific step (for users who want to skip ahead). */
export function skipToStep(
  userId: UserId,
  orgId: OrgId,
  targetStep: OnboardingStep
): OnboardingState | undefined {
  const state = onboardingStates.get(stateKey(userId, orgId));
  if (!state || state.completed) return undefined;

  const currentIdx = STEP_ORDER.indexOf(state.currentStep);
  const targetIdx = STEP_ORDER.indexOf(targetStep);

  // Can only skip forward, not backward
  if (targetIdx <= currentIdx) return undefined;

  state.currentStep = targetStep;
  return state;
}

/** Get a recommended template based on wizard answers. */
export function getRecommendedTemplate(answers: WizardAnswers): string {
  // Map use cases to template IDs
  const useCaseTemplateMap: Record<string, string> = {
    customer_support: 'customer-support',
    content_creation: 'podcast-cohost',
    market_research: 'research-assistant',
    community_engagement: 'community-moderator',
    other: 'community-moderator',
  };

  const templateId = useCaseTemplateMap[answers.useCase] ?? 'community-moderator';
  const template = getTemplate(templateId);
  return template ? templateId : AGENT_TEMPLATES[0].id;
}

/** Get onboarding progress as a percentage. */
export function getOnboardingProgress(
  userId: UserId,
  orgId: OrgId
): number {
  const state = onboardingStates.get(stateKey(userId, orgId));
  if (!state) return 0;

  const completedSteps = Object.keys(state.stepCompletedAt).length;
  return Math.round((completedSteps / STEP_ORDER.length) * 100);
}

/** Clear onboarding state (for testing or account deletion). */
export function clearOnboardingState(userId: UserId, orgId: OrgId): void {
  onboardingStates.delete(stateKey(userId, orgId));
}


