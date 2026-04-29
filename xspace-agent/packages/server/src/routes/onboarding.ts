// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// Onboarding API Routes — Self-serve PLG funnel endpoints
// =============================================================================

import { Router } from 'express';
import {
  startOnboarding,
  getOnboardingState,
  completeWelcomeWizard,
  completeAgentCreation,
  completeAgentTest,
  completeOnboarding,
  skipToStep,
  getRecommendedTemplate,
  getOnboardingProgress,
  AGENT_TEMPLATES,
  getTemplate,
  getTemplatesByCategory,
  getFeaturedTemplates,
  getTemplatesForPlan,
  evaluateUpgradeTriggers,
  dismissUpgradePrompt,
  getActivationSummary,
  trackActivation,
  enrollInDripCampaign,
  getDripCampaignState,
  unsubscribeFromDripCampaign,
  evaluateDueEmails,
  getAchievedActivations,
  getOrCreateReferralCode,
  getReferralByCode,
  markReferralSignedUp,
  getReferralSummary,
  getRecentEvents,
  getFunnelMetrics,
} from 'xspace-agent';
import type {
  WizardAnswers,
  QuickAgentInput,
  OnboardingStep,
  ActivationEvent,
} from 'xspace-agent';
import { validate } from '../middleware/validation';
import { buildErrorResponse } from '../middleware/error-handler';
import {
  StartOnboardingBodySchema,
  OnboardingParamsSchema,
  WelcomeWizardBodySchema,
  CreateAgentBodySchema,
  UserOrgBodySchema,
  SkipStepBodySchema,
  EvaluateTriggersBodySchema,
  DismissTriggerBodySchema,
  TrackActivationBodySchema,
  DripEvaluateBodySchema,
  ReferralSignupBodySchema,
  FunnelQuerySchema,
} from '../schemas/onboarding';

export function createOnboardingRouter(): Router {
  const router = Router();

  // -------------------------------------------------------------------------
  // Onboarding Wizard
  // -------------------------------------------------------------------------

  /** Start onboarding for a new user. */
  router.post('/onboarding/start', validate(StartOnboardingBodySchema), (req, res) => {
    const { userId, orgId, signupMethod, referralCode } = (req as any).validated;
    const state = startOnboarding(userId, orgId, signupMethod ?? 'email', referralCode);
    res.json({ state, progress: getOnboardingProgress(userId, orgId) });
  });

  /** Get current onboarding state. */
  router.get('/onboarding/:orgId/:userId', validate(OnboardingParamsSchema, 'params'), (req, res) => {
    const { orgId, userId } = req.params;
    const state = getOnboardingState(userId, orgId);
    if (!state) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Onboarding not found', {
        requestId: (req as any).id,
      }));
      return;
    }
    res.json({ state, progress: getOnboardingProgress(userId, orgId) });
  });

  /** Complete the welcome wizard step. */
  router.post('/onboarding/welcome-wizard', validate(WelcomeWizardBodySchema), (req, res) => {
    const { userId, orgId, answers } = (req as any).validated;
    const state = completeWelcomeWizard(userId, orgId, answers);
    if (!state) {
      res.status(400).json(buildErrorResponse('VALIDATION_ERROR', 'Invalid state for welcome wizard completion', {
        requestId: (req as any).id,
      }));
      return;
    }
    const recommendedTemplate = getRecommendedTemplate(answers);
    res.json({ state, recommendedTemplate, progress: getOnboardingProgress(userId, orgId) });
  });

  /** Complete the agent creation step. */
  router.post('/onboarding/create-agent', validate(CreateAgentBodySchema), (req, res) => {
    const { userId, orgId, input } = (req as any).validated;
    const state = completeAgentCreation(userId, orgId, input);
    if (!state) {
      res.status(400).json(buildErrorResponse('VALIDATION_ERROR', 'Invalid state for agent creation', {
        requestId: (req as any).id,
      }));
      return;
    }
    res.json({ state, progress: getOnboardingProgress(userId, orgId) });
  });

  /** Complete the agent test step. */
  router.post('/onboarding/test-agent', validate(UserOrgBodySchema), (req, res) => {
    const { userId, orgId } = (req as any).validated;
    const state = completeAgentTest(userId, orgId);
    if (!state) {
      res.status(400).json(buildErrorResponse('VALIDATION_ERROR', 'Invalid state for test completion', {
        requestId: (req as any).id,
      }));
      return;
    }
    res.json({ state, progress: getOnboardingProgress(userId, orgId) });
  });

  /** Complete onboarding. */
  router.post('/onboarding/complete', validate(UserOrgBodySchema), (req, res) => {
    const { userId, orgId } = (req as any).validated;
    const state = completeOnboarding(userId, orgId);
    if (!state) {
      res.status(400).json(buildErrorResponse('VALIDATION_ERROR', 'Onboarding already complete or not found', {
        requestId: (req as any).id,
      }));
      return;
    }
    res.json({ state, progress: 100 });
  });

  /** Skip to a specific onboarding step. */
  router.post('/onboarding/skip', validate(SkipStepBodySchema), (req, res) => {
    const { userId, orgId, targetStep } = (req as any).validated;
    const state = skipToStep(userId, orgId, targetStep as OnboardingStep);
    if (!state) {
      res.status(400).json(buildErrorResponse('VALIDATION_ERROR', 'Cannot skip to target step', {
        requestId: (req as any).id,
      }));
      return;
    }
    res.json({ state, progress: getOnboardingProgress(userId, orgId) });
  });

  // -------------------------------------------------------------------------
  // Agent Templates
  // -------------------------------------------------------------------------

  /** Get all templates. */
  router.get('/templates', (_req, res) => {
    res.json({ templates: AGENT_TEMPLATES });
  });

  /** Get featured templates. */
  router.get('/templates/featured', (_req, res) => {
    res.json({ templates: getFeaturedTemplates() });
  });

  /** Get templates for a plan tier. */
  router.get('/templates/plan/:tier', (req, res) => {
    res.json({ templates: getTemplatesForPlan(req.params.tier) });
  });

  /** Get templates by category. */
  router.get('/templates/category/:category', (req, res) => {
    const category = req.params.category as any;
    res.json({ templates: getTemplatesByCategory(category) });
  });

  /** Get a single template. */
  router.get('/templates/:id', (req, res) => {
    const template = getTemplate(req.params.id);
    if (!template) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Template not found', {
        requestId: (req as any).id,
      }));
      return;
    }
    res.json({ template });
  });

  // -------------------------------------------------------------------------
  // Upgrade Triggers
  // -------------------------------------------------------------------------

  /** Evaluate upgrade triggers for an org. */
  router.post('/upgrade-triggers/evaluate', validate(EvaluateTriggersBodySchema), (req, res) => {
    const { orgId, currentPlan, quotas, context } = (req as any).validated;
    const prompts = evaluateUpgradeTriggers(orgId, currentPlan, quotas, context);
    res.json({ prompts });
  });

  /** Dismiss an upgrade prompt. */
  router.post('/upgrade-triggers/dismiss', validate(DismissTriggerBodySchema), (req, res) => {
    const { orgId, triggerId } = (req as any).validated;
    dismissUpgradePrompt(orgId, triggerId);
    res.json({ success: true });
  });

  // -------------------------------------------------------------------------
  // Activation Tracking
  // -------------------------------------------------------------------------

  /** Get activation summary for an org. */
  router.get('/activation/:orgId', (req, res) => {
    const summary = getActivationSummary(req.params.orgId);
    res.json({ summary });
  });

  /** Track an activation event. */
  router.post('/activation/track', validate(TrackActivationBodySchema), (req, res) => {
    const { event, userId, orgId, metadata } = (req as any).validated;
    const record = trackActivation(event as ActivationEvent, userId, orgId, metadata);
    res.json({ tracked: !!record, record });
  });

  // -------------------------------------------------------------------------
  // Drip Campaign
  // -------------------------------------------------------------------------

  /** Get drip campaign state for a user. */
  router.get('/drip/:orgId/:userId', validate(OnboardingParamsSchema, 'params'), (req, res) => {
    const state = getDripCampaignState(req.params.userId, req.params.orgId);
    if (!state) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Drip campaign not found', {
        requestId: (req as any).id,
      }));
      return;
    }
    res.json({ state });
  });

  /** Evaluate due emails for a user. */
  router.post('/drip/evaluate', validate(DripEvaluateBodySchema), (req, res) => {
    const { userId, orgId, currentPlan } = (req as any).validated;
    const activationEvents = getAchievedActivations(orgId);
    const dueEmails = evaluateDueEmails(userId, orgId, { currentPlan, activationEvents });
    res.json({ dueEmails });
  });

  /** Unsubscribe from drip campaign. */
  router.post('/drip/unsubscribe', validate(UserOrgBodySchema), (req, res) => {
    const { userId, orgId } = (req as any).validated;
    const success = unsubscribeFromDripCampaign(userId, orgId);
    res.json({ success });
  });

  // -------------------------------------------------------------------------
  // Referral Program
  // -------------------------------------------------------------------------

  /** Get referral code for a user. */
  router.get('/referral/code/:userId', (req, res) => {
    const code = getOrCreateReferralCode(req.params.userId);
    res.json({ code });
  });

  /** Get referral summary for a user. */
  router.get('/referral/summary/:userId', (req, res) => {
    const summary = getReferralSummary(req.params.userId);
    res.json({ summary });
  });

  /** Look up a referral by code. */
  router.get('/referral/lookup/:code', (req, res) => {
    const referral = getReferralByCode(req.params.code);
    if (!referral) {
      res.status(404).json(buildErrorResponse('NOT_FOUND', 'Referral not found', {
        requestId: (req as any).id,
      }));
      return;
    }
    res.json({ referral });
  });

  /** Record a referral signup. */
  router.post('/referral/signup', validate(ReferralSignupBodySchema), (req, res) => {
    const { code, referredUserId, referredOrgId } = (req as any).validated;
    const referral = markReferralSignedUp(code, referredUserId, referredOrgId);
    if (!referral) {
      res.status(400).json(buildErrorResponse('VALIDATION_ERROR', 'Invalid or already-used referral code', {
        requestId: (req as any).id,
      }));
      return;
    }
    res.json({ referral });
  });

  // -------------------------------------------------------------------------
  // Product Analytics
  // -------------------------------------------------------------------------

  /** Get recent analytics events. */
  router.get('/analytics/events', (req, res) => {
    const { category, userId, orgId, limit } = req.query;
    const events = getRecentEvents({
      category: category as any,
      userId: userId as string,
      orgId: orgId as string,
      limit: limit ? parseInt(limit as string, 10) : 50,
    });
    res.json({ events });
  });

  /** Get funnel metrics for a time period. */
  router.get('/analytics/funnel', validate(FunnelQuerySchema, 'query'), (req, res) => {
    const { start, end } = (req as any).validated;
    const metrics = getFunnelMetrics(new Date(start as string), new Date(end as string));
    res.json({ metrics });
  });

  return router;
}


