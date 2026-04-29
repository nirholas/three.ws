// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§72]

// =============================================================================
// Onboarding & PLG Funnel — Tests
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest'

import {
  // Onboarding orchestrator
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
  // Templates
  AGENT_TEMPLATES,
  getTemplate,
  getTemplatesByCategory,
  getTemplatesForPlan,
  getFeaturedTemplates,
  // Activation
  ACTIVATION_EVENTS,
  trackActivation,
  getActivationRecords,
  getAchievedActivations,
  getActivationSummary,
  hasActivation,
  clearActivations,
  // Upgrade triggers
  UPGRADE_TRIGGERS,
  resolveNextTier,
  evaluateUpgradeTriggers,
  dismissUpgradePrompt,
  // Drip campaign
  DRIP_EMAILS,
  enrollInDripCampaign,
  getDripCampaignState,
  unsubscribeFromDripCampaign,
  recordDripEmailSent,
  evaluateDueEmails,
  // Referral
  getOrCreateReferralCode,
  createReferral,
  getReferralByCode,
  markReferralSignedUp,
  markReferralConverted,
  applyReferralCredit,
  getReferralSummary,
  expireOldReferrals,
  clearReferrals,
  REFERRAL_CREDIT_CENTS,
  // Analytics
  trackEvent,
  trackSignup,
  getRecentEvents,
  getFunnelMetrics,
  clearEventBuffer,
  registerAnalyticsHandler,
  clearAnalyticsHandlers,
} from '../index'
import type { Quotas, WizardAnswers, QuickAgentInput } from '../index'

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const USER_ID = 'user-001'
const ORG_ID = 'org-001'

const WIZARD_ANSWERS: WizardAnswers = {
  useCase: 'customer_support',
  platform: 'x_spaces',
}

const AGENT_INPUT: QuickAgentInput = {
  name: 'My First Agent',
  personality: 'friendly',
  voiceId: 'alloy',
  templateId: 'customer-support',
}

const FREE_QUOTAS: Quotas = {
  maxAgents: 1,
  currentAgents: 1,
  maxConcurrentSessions: 1,
  currentSessions: 0,
  maxSessionMinutesPerMonth: 60,
  usedSessionMinutes: 0,
  maxApiCallsPerMinute: 10,
}

// ---------------------------------------------------------------------------
// Agent Templates
// ---------------------------------------------------------------------------

describe('Agent Templates', () => {
  it('should have at least 8 pre-built templates', () => {
    expect(AGENT_TEMPLATES.length).toBeGreaterThanOrEqual(8)
  })

  it('should get a template by ID', () => {
    const template = getTemplate('customer-support')
    expect(template).toBeDefined()
    expect(template!.name).toBe('Customer Support Agent')
    expect(template!.systemPrompt).toBeTruthy()
  })

  it('should return undefined for unknown template', () => {
    expect(getTemplate('nonexistent')).toBeUndefined()
  })

  it('should filter templates by category', () => {
    const contentTemplates = getTemplatesByCategory('content_creation')
    expect(contentTemplates.length).toBeGreaterThan(0)
    contentTemplates.forEach((t) => {
      expect(t.category).toBe('content_creation')
    })
  })

  it('should get featured templates', () => {
    const featured = getFeaturedTemplates()
    expect(featured.length).toBeGreaterThan(0)
    featured.forEach((t) => {
      expect(t.featured).toBe(true)
    })
  })

  it('should filter templates by plan tier', () => {
    const freeTemplates = getTemplatesForPlan('free')
    const devTemplates = getTemplatesForPlan('developer')
    // Developer plan should include all free templates plus dev-only ones
    expect(devTemplates.length).toBeGreaterThanOrEqual(freeTemplates.length)
  })

  it('should have valid template structure', () => {
    for (const template of AGENT_TEMPLATES) {
      expect(template.id).toBeTruthy()
      expect(template.name).toBeTruthy()
      expect(template.description).toBeTruthy()
      expect(template.systemPrompt).toBeTruthy()
      expect(template.personality).toBeTruthy()
      expect(template.suggestedVoiceId).toBeTruthy()
      expect(template.minPlan).toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// Onboarding Wizard Flow
// ---------------------------------------------------------------------------

describe('Onboarding Wizard', () => {
  beforeEach(() => {
    clearOnboardingState(USER_ID, ORG_ID)
    clearActivations(ORG_ID)
    clearEventBuffer()
  })

  it('should start onboarding and advance past signup', () => {
    const state = startOnboarding(USER_ID, ORG_ID, 'email')
    expect(state.userId).toBe(USER_ID)
    expect(state.orgId).toBe(ORG_ID)
    expect(state.currentStep).toBe('welcome_wizard')
    expect(state.stepCompletedAt.signup).toBeDefined()
    expect(state.completed).toBe(false)
  })

  it('should be idempotent on re-start', () => {
    const first = startOnboarding(USER_ID, ORG_ID, 'email')
    const second = startOnboarding(USER_ID, ORG_ID, 'github')
    expect(first).toBe(second) // Same reference
  })

  it('should complete welcome wizard', () => {
    startOnboarding(USER_ID, ORG_ID, 'email')
    const state = completeWelcomeWizard(USER_ID, ORG_ID, WIZARD_ANSWERS)
    expect(state).toBeDefined()
    expect(state!.currentStep).toBe('create_agent')
    expect(state!.wizardAnswers).toEqual(WIZARD_ANSWERS)
  })

  it('should reject welcome wizard if not on that step', () => {
    startOnboarding(USER_ID, ORG_ID, 'email')
    completeWelcomeWizard(USER_ID, ORG_ID, WIZARD_ANSWERS)
    // Try completing wizard again when on create_agent step
    const result = completeWelcomeWizard(USER_ID, ORG_ID, WIZARD_ANSWERS)
    expect(result).toBeUndefined()
  })

  it('should complete full onboarding flow', () => {
    startOnboarding(USER_ID, ORG_ID, 'google')
    completeWelcomeWizard(USER_ID, ORG_ID, WIZARD_ANSWERS)
    completeAgentCreation(USER_ID, ORG_ID, AGENT_INPUT)
    setOnboardingAgentId(USER_ID, ORG_ID, 'agent-123')
    completeAgentTest(USER_ID, ORG_ID)
    const final = completeOnboarding(USER_ID, ORG_ID)

    expect(final).toBeDefined()
    expect(final!.completed).toBe(true)
    expect(final!.completedAt).toBeDefined()
    expect(final!.agentId).toBe('agent-123')
    expect(final!.currentStep).toBe('complete')
    expect(getOnboardingProgress(USER_ID, ORG_ID)).toBe(100)
  })

  it('should track activation events during onboarding', () => {
    startOnboarding(USER_ID, ORG_ID, 'email')
    completeWelcomeWizard(USER_ID, ORG_ID, WIZARD_ANSWERS)
    completeAgentCreation(USER_ID, ORG_ID, AGENT_INPUT)

    expect(hasActivation(ORG_ID, 'agent_created')).toBe(true)

    completeAgentTest(USER_ID, ORG_ID)
    expect(hasActivation(ORG_ID, 'first_session_completed')).toBe(true)
  })

  it('should skip steps forward', () => {
    startOnboarding(USER_ID, ORG_ID, 'email')
    const state = skipToStep(USER_ID, ORG_ID, 'test_agent')
    expect(state).toBeDefined()
    expect(state!.currentStep).toBe('test_agent')
  })

  it('should not skip backward', () => {
    startOnboarding(USER_ID, ORG_ID, 'email')
    completeWelcomeWizard(USER_ID, ORG_ID, WIZARD_ANSWERS)
    const result = skipToStep(USER_ID, ORG_ID, 'welcome_wizard')
    expect(result).toBeUndefined()
  })

  it('should recommend templates based on wizard answers', () => {
    const templateId = getRecommendedTemplate({ useCase: 'customer_support', platform: 'x_spaces' })
    expect(templateId).toBe('customer-support')

    const researchId = getRecommendedTemplate({ useCase: 'market_research', platform: 'x_spaces' })
    expect(researchId).toBe('research-assistant')
  })

  it('should track onboarding progress correctly', () => {
    startOnboarding(USER_ID, ORG_ID, 'email')
    const p1 = getOnboardingProgress(USER_ID, ORG_ID)
    expect(p1).toBeGreaterThan(0)
    expect(p1).toBeLessThan(100)

    completeWelcomeWizard(USER_ID, ORG_ID, WIZARD_ANSWERS)
    const p2 = getOnboardingProgress(USER_ID, ORG_ID)
    expect(p2).toBeGreaterThan(p1)
  })
})

// ---------------------------------------------------------------------------
// Activation Tracking
// ---------------------------------------------------------------------------

describe('Activation Tracking', () => {
  beforeEach(() => {
    clearActivations(ORG_ID)
  })

  it('should define all activation events', () => {
    expect(ACTIVATION_EVENTS).toContain('agent_created')
    expect(ACTIVATION_EVENTS).toContain('first_session_completed')
    expect(ACTIVATION_EVENTS).toContain('agent_first_spoke')
    expect(ACTIVATION_EVENTS.length).toBe(6)
  })

  it('should track an activation event', () => {
    const record = trackActivation('agent_created', USER_ID, ORG_ID)
    expect(record).toBeDefined()
    expect(record!.event).toBe('agent_created')
    expect(record!.userId).toBe(USER_ID)
  })

  it('should be idempotent — duplicate events ignored', () => {
    trackActivation('agent_created', USER_ID, ORG_ID)
    const duplicate = trackActivation('agent_created', USER_ID, ORG_ID)
    expect(duplicate).toBeNull()
    expect(getActivationRecords(ORG_ID).length).toBe(1)
  })

  it('should build activation summary', () => {
    trackActivation('agent_created', USER_ID, ORG_ID)
    trackActivation('first_session_completed', USER_ID, ORG_ID)

    const summary = getActivationSummary(ORG_ID)
    expect(summary.achieved).toContain('agent_created')
    expect(summary.achieved).toContain('first_session_completed')
    expect(summary.pending).toContain('agent_first_spoke')
    expect(summary.score).toBe(Math.round((2 / 6) * 100))
  })

  it('should calculate time to first activation', () => {
    const signupTime = new Date(Date.now() - 60000) // 1 minute ago
    trackActivation('agent_created', USER_ID, ORG_ID)
    const summary = getActivationSummary(ORG_ID, signupTime)
    expect(summary.timeToFirstActivation).toBeDefined()
    expect(summary.timeToFirstActivation!).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Upgrade Triggers
// ---------------------------------------------------------------------------

describe('Upgrade Triggers', () => {
  it('should define multiple triggers', () => {
    expect(UPGRADE_TRIGGERS.length).toBeGreaterThan(0)
  })

  it('should resolve next tier correctly', () => {
    expect(resolveNextTier('free')).toBe('developer')
    expect(resolveNextTier('developer')).toBe('pro')
    expect(resolveNextTier('pro')).toBe('business')
    expect(resolveNextTier('business')).toBe('enterprise')
    expect(resolveNextTier('enterprise')).toBe('enterprise')
  })

  it('should fire agent_limit_reached when at max agents', () => {
    const prompts = evaluateUpgradeTriggers('org-trigger-1', 'free', FREE_QUOTAS)
    const agentLimit = prompts.find((p) => p.trigger.trigger === 'agent_limit_reached')
    expect(agentLimit).toBeDefined()
    expect(agentLimit!.targetPlan).toBe('developer')
  })

  it('should fire session_minutes_75_percent trigger', () => {
    const quotas: Quotas = { ...FREE_QUOTAS, currentAgents: 0, usedSessionMinutes: 50 }
    const prompts = evaluateUpgradeTriggers('org-trigger-2', 'free', quotas)
    const sessionTrigger = prompts.find((p) => p.trigger.trigger === 'session_minutes_75_percent')
    expect(sessionTrigger).toBeDefined()
  })

  it('should fire session_minutes_100_percent trigger', () => {
    const quotas: Quotas = { ...FREE_QUOTAS, currentAgents: 0, usedSessionMinutes: 60 }
    const prompts = evaluateUpgradeTriggers('org-trigger-3', 'free', quotas)
    const sessionTrigger = prompts.find((p) => p.trigger.trigger === 'session_minutes_100_percent')
    expect(sessionTrigger).toBeDefined()
  })

  it('should not fire triggers for enterprise plan', () => {
    const prompts = evaluateUpgradeTriggers('org-trigger-4', 'enterprise', FREE_QUOTAS)
    expect(prompts.length).toBe(0)
  })

  it('should sort prompts by priority (highest first)', () => {
    const quotas: Quotas = { ...FREE_QUOTAS, usedSessionMinutes: 60 }
    const prompts = evaluateUpgradeTriggers('org-trigger-5', 'free', quotas)
    for (let i = 1; i < prompts.length; i++) {
      expect(prompts[i - 1].trigger.priority).toBeGreaterThanOrEqual(prompts[i].trigger.priority)
    }
  })

  it('should fire team feature trigger when context provided', () => {
    const quotas: Quotas = { ...FREE_QUOTAS, currentAgents: 0 }
    const prompts = evaluateUpgradeTriggers('org-trigger-6', 'free', quotas, {
      featureAttempted: 'team',
    })
    const teamTrigger = prompts.find((p) => p.trigger.trigger === 'team_feature_attempted')
    expect(teamTrigger).toBeDefined()
    expect(teamTrigger!.targetPlan).toBe('pro')
  })

  it('should track fire counts', () => {
    evaluateUpgradeTriggers('org-trigger-7', 'free', FREE_QUOTAS)
    const prompts = evaluateUpgradeTriggers('org-trigger-7', 'free', FREE_QUOTAS)
    const agentLimit = prompts.find((p) => p.trigger.trigger === 'agent_limit_reached')
    expect(agentLimit!.fireCount).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Drip Campaign
// ---------------------------------------------------------------------------

describe('Drip Campaign', () => {
  it('should define the full email sequence', () => {
    expect(DRIP_EMAILS.length).toBe(9)
    expect(DRIP_EMAILS[0].id).toBe('welcome')
    expect(DRIP_EMAILS[DRIP_EMAILS.length - 1].id).toBe('trial_summary')
  })

  it('should enroll a user in the drip campaign', () => {
    const state = enrollInDripCampaign('drip-user', 'drip-org')
    expect(state.userId).toBe('drip-user')
    expect(state.orgId).toBe('drip-org')
    expect(state.sent).toEqual([])
    expect(state.unsubscribed).toBe(false)
  })

  it('should be idempotent on re-enrollment', () => {
    const first = enrollInDripCampaign('drip-user-2', 'drip-org-2')
    const second = enrollInDripCampaign('drip-user-2', 'drip-org-2')
    expect(first).toBe(second)
  })

  it('should evaluate due emails on day 0', () => {
    enrollInDripCampaign('drip-user-3', 'drip-org-3')
    const due = evaluateDueEmails('drip-user-3', 'drip-org-3', {
      currentPlan: 'free',
      activationEvents: [],
    })
    // Day 0: welcome email should be due
    expect(due.some((e) => e.id === 'welcome')).toBe(true)
  })

  it('should not include already-sent emails', () => {
    enrollInDripCampaign('drip-user-4', 'drip-org-4')
    recordDripEmailSent('drip-user-4', 'drip-org-4', 'welcome')
    const due = evaluateDueEmails('drip-user-4', 'drip-org-4', {
      currentPlan: 'free',
      activationEvents: [],
    })
    expect(due.some((e) => e.id === 'welcome')).toBe(false)
  })

  it('should skip activation_reminder if agent already created', () => {
    enrollInDripCampaign('drip-user-5', 'drip-org-5')
    const tomorrow = new Date(Date.now() + 86400000 * 2)
    const due = evaluateDueEmails('drip-user-5', 'drip-org-5', {
      currentPlan: 'free',
      activationEvents: ['agent_created'],
      now: tomorrow,
    })
    expect(due.some((e) => e.id === 'activation_reminder')).toBe(false)
  })

  it('should respect unsubscribe', () => {
    enrollInDripCampaign('drip-user-6', 'drip-org-6')
    unsubscribeFromDripCampaign('drip-user-6', 'drip-org-6')
    const due = evaluateDueEmails('drip-user-6', 'drip-org-6', {
      currentPlan: 'free',
      activationEvents: [],
    })
    expect(due.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Referral Program
// ---------------------------------------------------------------------------

describe('Referral Program', () => {
  const REFERRER_ID = 'referrer-001'
  const REFERRER_ORG = 'referrer-org'
  const REFERRED_USER = 'referred-001'
  const REFERRED_ORG = 'referred-org'

  beforeEach(() => {
    clearReferrals(REFERRER_ID)
  })

  it('should generate a referral code for a user', () => {
    const code = getOrCreateReferralCode(REFERRER_ID)
    expect(code).toBeTruthy()
    expect(typeof code).toBe('string')
  })

  it('should return the same code on repeated calls', () => {
    const code1 = getOrCreateReferralCode(REFERRER_ID)
    const code2 = getOrCreateReferralCode(REFERRER_ID)
    expect(code1).toBe(code2)
  })

  it('should create a referral', () => {
    const referral = createReferral(REFERRER_ID, REFERRER_ORG, 'friend@example.com')
    expect(referral.referrerId).toBe(REFERRER_ID)
    expect(referral.status).toBe('pending')
    expect(referral.creditCents).toBe(0)
  })

  it('should look up referral by code', () => {
    const referral = createReferral(REFERRER_ID, REFERRER_ORG)
    const found = getReferralByCode(referral.code)
    expect(found).toBeDefined()
    expect(found!.id).toBe(referral.id)
  })

  it('should track referral signup and conversion', () => {
    const referral = createReferral(REFERRER_ID, REFERRER_ORG)

    const signedUp = markReferralSignedUp(referral.code, REFERRED_USER, REFERRED_ORG)
    expect(signedUp).toBeDefined()
    expect(signedUp!.status).toBe('signed_up')
    expect(signedUp!.referredUserId).toBe(REFERRED_USER)

    const converted = markReferralConverted(REFERRED_ORG)
    expect(converted).toBeDefined()
    expect(converted!.status).toBe('converted')
    expect(converted!.creditCents).toBe(REFERRAL_CREDIT_CENTS)
  })

  it('should apply referral credit', () => {
    const referral = createReferral(REFERRER_ID, REFERRER_ORG)
    markReferralSignedUp(referral.code, REFERRED_USER, REFERRED_ORG)
    markReferralConverted(REFERRED_ORG)

    const applied = applyReferralCredit(referral.id)
    expect(applied).toBe(true)

    // Cannot apply twice
    const reapplied = applyReferralCredit(referral.id)
    expect(reapplied).toBe(false)
  })

  it('should build referral summary', () => {
    const referral = createReferral(REFERRER_ID, REFERRER_ORG)
    markReferralSignedUp(referral.code, REFERRED_USER, REFERRED_ORG)
    markReferralConverted(REFERRED_ORG)

    const summary = getReferralSummary(REFERRER_ID)
    expect(summary.totalReferrals).toBe(1)
    expect(summary.conversions).toBe(1)
    expect(summary.totalCreditsCents).toBe(REFERRAL_CREDIT_CENTS)
    expect(summary.pendingCreditsCents).toBe(REFERRAL_CREDIT_CENTS) // not yet applied
  })

  it('should expire old pending referrals', () => {
    createReferral(REFERRER_ID, REFERRER_ORG)
    // Set expiry to 91 days from now (past the 90 day expiry)
    const futureDate = new Date(Date.now() + 91 * 86400000)
    const expired = expireOldReferrals(futureDate)
    expect(expired).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Product Analytics
// ---------------------------------------------------------------------------

describe('Product Analytics', () => {
  beforeEach(() => {
    clearEventBuffer()
    clearAnalyticsHandlers()
  })

  it('should track events', () => {
    const event = trackEvent('test.event', 'engagement', { foo: 'bar' }, USER_ID, ORG_ID)
    expect(event.name).toBe('test.event')
    expect(event.category).toBe('engagement')
    expect(event.properties.foo).toBe('bar')
  })

  it('should forward events to registered handlers', () => {
    const received: any[] = []
    registerAnalyticsHandler((event) => received.push(event))

    trackSignup(USER_ID, ORG_ID, 'email')
    expect(received.length).toBe(1)
    expect(received[0].name).toBe('onboarding.signup')
  })

  it('should query recent events with filters', () => {
    trackEvent('e1', 'onboarding', {}, USER_ID, ORG_ID)
    trackEvent('e2', 'engagement', {}, USER_ID, ORG_ID)
    trackEvent('e3', 'onboarding', {}, 'other-user', ORG_ID)

    const onboardingEvents = getRecentEvents({ category: 'onboarding' })
    expect(onboardingEvents.length).toBe(2)

    const userEvents = getRecentEvents({ userId: USER_ID })
    expect(userEvents.length).toBe(2)
  })

  it('should calculate funnel metrics', () => {
    const start = new Date(Date.now() - 86400000)
    const end = new Date(Date.now() + 86400000)

    trackSignup('u1', 'o1', 'email')
    trackSignup('u2', 'o2', 'google')

    const metrics = getFunnelMetrics(start, end)
    expect(metrics.signups).toBe(2)
  })

  it('should handle handler errors gracefully', () => {
    registerAnalyticsHandler(() => {
      throw new Error('Handler crashed')
    })
    // Should not throw
    expect(() => trackEvent('safe', 'engagement', {})).not.toThrow()
  })
})


