// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Tests — Onboarding Routes (createOnboardingRouter)
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import { createTestApp } from '../helpers/test-app'

// ---------------------------------------------------------------------------
// Mock xspace-agent — all data must be inline (vi.mock is hoisted)
// ---------------------------------------------------------------------------

vi.mock('xspace-agent', () => {
  const onboardingState = {
    userId: 'user-1',
    orgId: 'org-1',
    currentStep: 'welcome',
    completedSteps: [] as string[],
    startedAt: '2025-01-01T00:00:00Z',
  }

  const wizardState = {
    ...onboardingState,
    currentStep: 'create_agent',
    completedSteps: ['welcome'],
  }

  const templates = [
    { id: 'tmpl-1', name: 'Podcast Host', category: 'entertainment', featured: true, plans: ['free', 'pro'] },
    { id: 'tmpl-2', name: 'Debate Bot', category: 'moderation', featured: false, plans: ['pro', 'enterprise'] },
  ]

  const dripState = {
    userId: 'user-1',
    orgId: 'org-1',
    enrolled: true,
    sentEmails: [],
  }

  const referral = {
    code: 'ABC123',
    userId: 'user-1',
    signups: [] as string[],
  }

  return {
    startOnboarding: vi.fn(() => onboardingState),
    getOnboardingState: vi.fn((userId: string, orgId: string) => {
      if (userId === 'user-1' && orgId === 'org-1') return onboardingState
      return null
    }),
    completeWelcomeWizard: vi.fn(() => wizardState),
    completeAgentCreation: vi.fn(() => ({
      ...onboardingState,
      currentStep: 'test_agent',
      completedSteps: ['welcome', 'create_agent'],
    })),
    completeAgentTest: vi.fn(() => ({
      ...onboardingState,
      currentStep: 'complete',
      completedSteps: ['welcome', 'create_agent', 'test_agent'],
    })),
    completeOnboarding: vi.fn((userId: string, orgId: string) => {
      if (userId === 'user-1' && orgId === 'org-1') {
        return {
          ...onboardingState,
          currentStep: 'done',
          completedSteps: ['welcome', 'create_agent', 'test_agent', 'complete'],
        }
      }
      return null
    }),
    skipToStep: vi.fn((_userId: string, _orgId: string, step: string) => {
      if (step === 'invalid_step') return null
      return { ...onboardingState, currentStep: step }
    }),
    getRecommendedTemplate: vi.fn(() => templates[0]),
    getOnboardingProgress: vi.fn(() => 25),
    AGENT_TEMPLATES: templates,
    getTemplate: vi.fn((id: string) => templates.find((t) => t.id === id) ?? null),
    getTemplatesByCategory: vi.fn((cat: string) => templates.filter((t) => t.category === cat)),
    getFeaturedTemplates: vi.fn(() => templates.filter((t) => t.featured)),
    getTemplatesForPlan: vi.fn(() => templates),
    evaluateUpgradeTriggers: vi.fn(() => [{ id: 'trigger-1', message: 'Upgrade for more agents' }]),
    dismissUpgradePrompt: vi.fn(),
    getActivationSummary: vi.fn(() => ({
      orgId: 'org-1',
      events: ['first_agent', 'first_session'],
      score: 50,
    })),
    trackActivation: vi.fn(() => ({
      event: 'first_agent',
      userId: 'user-1',
      orgId: 'org-1',
      trackedAt: '2025-01-01T00:00:00Z',
    })),
    enrollInDripCampaign: vi.fn(),
    getDripCampaignState: vi.fn((userId: string, orgId: string) => {
      if (userId === 'user-1' && orgId === 'org-1') return dripState
      return null
    }),
    unsubscribeFromDripCampaign: vi.fn(() => true),
    evaluateDueEmails: vi.fn(() => ['welcome', 'day-3']),
    getAchievedActivations: vi.fn(() => ['first_agent']),
    getOrCreateReferralCode: vi.fn(() => 'ABC123'),
    getReferralByCode: vi.fn((code: string) => {
      if (code === 'ABC123') return referral
      return null
    }),
    markReferralSignedUp: vi.fn((code: string) => {
      if (code === 'ABC123') return { ...referral, signups: ['referred-user-1'] }
      return null
    }),
    getReferralSummary: vi.fn(() => ({
      code: 'ABC123',
      totalReferrals: 3,
      convertedReferrals: 1,
    })),
    getRecentEvents: vi.fn(() => [
      { type: 'page_view', userId: 'user-1', timestamp: '2025-01-01' },
    ]),
    getFunnelMetrics: vi.fn(() => ({
      signups: 100,
      activated: 60,
      retained: 40,
    })),
  }
})

import { createOnboardingRouter } from '../../src/routes/onboarding'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Onboarding Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function buildApp() {
    const app = createTestApp()
    app.use(createOnboardingRouter())
    return app
  }

  // =========================================================================
  // Onboarding Wizard
  // =========================================================================

  describe('POST /onboarding/start', () => {
    it('starts onboarding for a new user', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/onboarding/start')
        .send({ userId: 'user-1', orgId: 'org-1' })

      expect(res.status).toBe(200)
      expect(res.body.state).toBeDefined()
      expect(res.body.progress).toBeDefined()
    })

    it('accepts optional signupMethod and referralCode', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/onboarding/start')
        .send({ userId: 'user-1', orgId: 'org-1', signupMethod: 'github', referralCode: 'ABC123' })

      expect(res.status).toBe(200)
    })

    it('returns 400 when userId is missing', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/onboarding/start')
        .send({ orgId: 'org-1' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when orgId is missing', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/onboarding/start')
        .send({ userId: 'user-1' })

      expect(res.status).toBe(400)
    })
  })

  describe('GET /onboarding/:orgId/:userId', () => {
    it('returns current onboarding state', async () => {
      const app = buildApp()
      const res = await request(app).get('/onboarding/org-1/user-1')

      expect(res.status).toBe(200)
      expect(res.body.state.userId).toBe('user-1')
      expect(res.body.progress).toBe(25)
    })

    it('returns 404 when onboarding not found', async () => {
      const app = buildApp()
      const res = await request(app).get('/onboarding/org-99/user-99')

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })
  })

  describe('POST /onboarding/welcome-wizard', () => {
    it('completes the welcome wizard step', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/onboarding/welcome-wizard')
        .send({
          userId: 'user-1',
          orgId: 'org-1',
          answers: { useCase: 'podcasting', teamSize: '1-5' },
        })

      expect(res.status).toBe(200)
      expect(res.body.state.currentStep).toBe('create_agent')
      expect(res.body.recommendedTemplate).toBeDefined()
    })

    it('returns 400 for invalid state', async () => {
      const { completeWelcomeWizard } = await import('xspace-agent')
      ;(completeWelcomeWizard as any).mockReturnValueOnce(null)

      const app = buildApp()
      const res = await request(app)
        .post('/onboarding/welcome-wizard')
        .send({
          userId: 'user-1',
          orgId: 'org-1',
          answers: { useCase: 'test' },
        })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when answers is missing', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/onboarding/welcome-wizard')
        .send({ userId: 'user-1', orgId: 'org-1' })

      expect(res.status).toBe(400)
    })
  })

  describe('POST /onboarding/create-agent', () => {
    it('completes the agent creation step', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/onboarding/create-agent')
        .send({
          userId: 'user-1',
          orgId: 'org-1',
          input: { name: 'My Agent', templateId: 'tmpl-1' },
        })

      expect(res.status).toBe(200)
      expect(res.body.state.currentStep).toBe('test_agent')
    })

    it('returns 400 for invalid state', async () => {
      const { completeAgentCreation } = await import('xspace-agent')
      ;(completeAgentCreation as any).mockReturnValueOnce(null)

      const app = buildApp()
      const res = await request(app)
        .post('/onboarding/create-agent')
        .send({
          userId: 'user-1',
          orgId: 'org-1',
          input: { name: 'Test' },
        })

      expect(res.status).toBe(400)
    })
  })

  describe('POST /onboarding/test-agent', () => {
    it('completes the agent test step', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/onboarding/test-agent')
        .send({ userId: 'user-1', orgId: 'org-1' })

      expect(res.status).toBe(200)
      expect(res.body.state.currentStep).toBe('complete')
    })

    it('returns 400 for invalid state', async () => {
      const { completeAgentTest } = await import('xspace-agent')
      ;(completeAgentTest as any).mockReturnValueOnce(null)

      const app = buildApp()
      const res = await request(app)
        .post('/onboarding/test-agent')
        .send({ userId: 'user-1', orgId: 'org-1' })

      expect(res.status).toBe(400)
    })
  })

  describe('POST /onboarding/complete', () => {
    it('completes onboarding', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/onboarding/complete')
        .send({ userId: 'user-1', orgId: 'org-1' })

      expect(res.status).toBe(200)
      expect(res.body.state.currentStep).toBe('done')
      expect(res.body.progress).toBe(100)
    })

    it('returns 400 when already complete or not found', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/onboarding/complete')
        .send({ userId: 'user-99', orgId: 'org-99' })

      expect(res.status).toBe(400)
    })
  })

  describe('POST /onboarding/skip', () => {
    it('skips to a target step', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/onboarding/skip')
        .send({ userId: 'user-1', orgId: 'org-1', targetStep: 'test_agent' })

      expect(res.status).toBe(200)
      expect(res.body.state.currentStep).toBe('test_agent')
    })

    it('returns 400 when skip is not allowed', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/onboarding/skip')
        .send({ userId: 'user-1', orgId: 'org-1', targetStep: 'invalid_step' })

      expect(res.status).toBe(400)
    })

    it('returns 400 when targetStep is missing', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/onboarding/skip')
        .send({ userId: 'user-1', orgId: 'org-1' })

      expect(res.status).toBe(400)
    })
  })

  // =========================================================================
  // Agent Templates
  // =========================================================================

  describe('GET /templates', () => {
    it('returns all templates', async () => {
      const app = buildApp()
      const res = await request(app).get('/templates')

      expect(res.status).toBe(200)
      expect(res.body.templates).toHaveLength(2)
    })
  })

  describe('GET /templates/featured', () => {
    it('returns featured templates', async () => {
      const app = buildApp()
      const res = await request(app).get('/templates/featured')

      expect(res.status).toBe(200)
      expect(res.body.templates).toHaveLength(1)
      expect(res.body.templates[0].featured).toBe(true)
    })
  })

  describe('GET /templates/plan/:tier', () => {
    it('returns templates for a plan tier', async () => {
      const app = buildApp()
      const res = await request(app).get('/templates/plan/pro')

      expect(res.status).toBe(200)
      expect(res.body.templates).toBeDefined()
    })
  })

  describe('GET /templates/category/:category', () => {
    it('returns templates by category', async () => {
      const app = buildApp()
      const res = await request(app).get('/templates/category/entertainment')

      expect(res.status).toBe(200)
      expect(res.body.templates).toHaveLength(1)
    })
  })

  describe('GET /templates/:id', () => {
    it('returns a specific template', async () => {
      const app = buildApp()
      const res = await request(app).get('/templates/tmpl-1')

      expect(res.status).toBe(200)
      expect(res.body.template.name).toBe('Podcast Host')
    })

    it('returns 404 for unknown template', async () => {
      const app = buildApp()
      const res = await request(app).get('/templates/nonexistent')

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })
  })

  // =========================================================================
  // Upgrade Triggers
  // =========================================================================

  describe('POST /upgrade-triggers/evaluate', () => {
    it('evaluates upgrade triggers', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/upgrade-triggers/evaluate')
        .send({
          orgId: 'org-1',
          currentPlan: 'free',
          quotas: { agents: 3, maxAgents: 3 },
        })

      expect(res.status).toBe(200)
      expect(res.body.prompts).toHaveLength(1)
    })
  })

  describe('POST /upgrade-triggers/dismiss', () => {
    it('dismisses an upgrade prompt', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/upgrade-triggers/dismiss')
        .send({ orgId: 'org-1', triggerId: 'trigger-1' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })

  // =========================================================================
  // Activation Tracking
  // =========================================================================

  describe('GET /activation/:orgId', () => {
    it('returns activation summary', async () => {
      const app = buildApp()
      const res = await request(app).get('/activation/org-1')

      expect(res.status).toBe(200)
      expect(res.body.summary.score).toBe(50)
    })
  })

  describe('POST /activation/track', () => {
    it('tracks an activation event', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/activation/track')
        .send({
          event: 'first_agent',
          userId: 'user-1',
          orgId: 'org-1',
        })

      expect(res.status).toBe(200)
      expect(res.body.tracked).toBe(true)
      expect(res.body.record).toBeDefined()
    })

    it('returns 400 when event is missing', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/activation/track')
        .send({ userId: 'user-1', orgId: 'org-1' })

      expect(res.status).toBe(400)
    })
  })

  // =========================================================================
  // Drip Campaign
  // =========================================================================

  describe('GET /drip/:orgId/:userId', () => {
    it('returns drip campaign state', async () => {
      const app = buildApp()
      const res = await request(app).get('/drip/org-1/user-1')

      expect(res.status).toBe(200)
      expect(res.body.state.enrolled).toBe(true)
    })

    it('returns 404 when not enrolled', async () => {
      const app = buildApp()
      const res = await request(app).get('/drip/org-99/user-99')

      expect(res.status).toBe(404)
    })
  })

  describe('POST /drip/evaluate', () => {
    it('evaluates due emails', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/drip/evaluate')
        .send({ userId: 'user-1', orgId: 'org-1', currentPlan: 'free' })

      expect(res.status).toBe(200)
      expect(res.body.dueEmails).toHaveLength(2)
    })
  })

  describe('POST /drip/unsubscribe', () => {
    it('unsubscribes from drip campaign', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/drip/unsubscribe')
        .send({ userId: 'user-1', orgId: 'org-1' })

      expect(res.status).toBe(200)
      expect(res.body.success).toBe(true)
    })
  })

  // =========================================================================
  // Referral Program
  // =========================================================================

  describe('GET /referral/code/:userId', () => {
    it('returns a referral code', async () => {
      const app = buildApp()
      const res = await request(app).get('/referral/code/user-1')

      expect(res.status).toBe(200)
      expect(res.body.code).toBe('ABC123')
    })
  })

  describe('GET /referral/summary/:userId', () => {
    it('returns referral summary', async () => {
      const app = buildApp()
      const res = await request(app).get('/referral/summary/user-1')

      expect(res.status).toBe(200)
      expect(res.body.summary.totalReferrals).toBe(3)
    })
  })

  describe('GET /referral/lookup/:code', () => {
    it('looks up a referral by code', async () => {
      const app = buildApp()
      const res = await request(app).get('/referral/lookup/ABC123')

      expect(res.status).toBe(200)
      expect(res.body.referral.code).toBe('ABC123')
    })

    it('returns 404 for unknown code', async () => {
      const app = buildApp()
      const res = await request(app).get('/referral/lookup/UNKNOWN')

      expect(res.status).toBe(404)
    })
  })

  describe('POST /referral/signup', () => {
    it('records a referral signup', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/referral/signup')
        .send({
          code: 'ABC123',
          referredUserId: 'new-user-1',
          referredOrgId: 'new-org-1',
        })

      expect(res.status).toBe(200)
      expect(res.body.referral).toBeDefined()
    })

    it('returns 400 for invalid code', async () => {
      const app = buildApp()
      const res = await request(app)
        .post('/referral/signup')
        .send({
          code: 'INVALID',
          referredUserId: 'new-user-1',
          referredOrgId: 'new-org-1',
        })

      expect(res.status).toBe(400)
    })
  })

  // =========================================================================
  // Product Analytics
  // =========================================================================

  describe('GET /analytics/events', () => {
    it('returns recent events', async () => {
      const app = buildApp()
      const res = await request(app).get('/analytics/events')

      expect(res.status).toBe(200)
      expect(res.body.events).toHaveLength(1)
    })

    it('passes filter parameters', async () => {
      const { getRecentEvents } = await import('xspace-agent')
      const app = buildApp()
      await request(app).get('/analytics/events?category=onboarding&userId=user-1&orgId=org-1&limit=10')

      expect(getRecentEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'onboarding',
          userId: 'user-1',
          orgId: 'org-1',
          limit: 10,
        }),
      )
    })
  })

  describe('GET /analytics/funnel', () => {
    it('returns funnel metrics for a time period', async () => {
      const app = buildApp()
      const res = await request(app).get('/analytics/funnel?start=2025-01-01&end=2025-01-31')

      expect(res.status).toBe(200)
      expect(res.body.metrics.signups).toBe(100)
      expect(res.body.metrics.activated).toBe(60)
    })

    it('returns 400 when start is missing', async () => {
      const app = buildApp()
      const res = await request(app).get('/analytics/funnel?end=2025-01-31')

      expect(res.status).toBe(400)
    })

    it('returns 400 when end is missing', async () => {
      const app = buildApp()
      const res = await request(app).get('/analytics/funnel?start=2025-01-01')

      expect(res.status).toBe(400)
    })
  })
})


