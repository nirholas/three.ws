// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// White-Label & Reseller Program — Tests
// =============================================================================

import { describe, it, expect } from 'vitest'
import {
  getWholesaleDiscount,
  WHITE_LABEL_PRICING,
  WHITE_LABEL_FEATURES,
  WHOLESALE_DISCOUNT_TIERS,
} from '../reseller/types'
import type {
  WhiteLabelConfig,
  WhiteLabelTier,
  CreateResellerInput,
  CreateSubOrgInput,
  CreateCustomDomainInput,
  StartImpersonationInput,
  ResellerBillingSummary,
  ResellerAnalytics,
  DnsRecord,
} from '../reseller/types'

// =============================================================================
// Wholesale Discount Calculation
// =============================================================================

describe('getWholesaleDiscount', () => {
  it('returns base 40% discount for 0 sub-orgs', () => {
    expect(getWholesaleDiscount(0)).toBe(0.4)
  })

  it('returns base 40% discount for under 50 sub-orgs', () => {
    expect(getWholesaleDiscount(1)).toBe(0.4)
    expect(getWholesaleDiscount(25)).toBe(0.4)
    expect(getWholesaleDiscount(49)).toBe(0.4)
  })

  it('returns 50% discount for 50+ sub-orgs', () => {
    expect(getWholesaleDiscount(50)).toBe(0.5)
    expect(getWholesaleDiscount(100)).toBe(0.5)
    expect(getWholesaleDiscount(199)).toBe(0.5)
  })

  it('returns 60% discount for 200+ sub-orgs', () => {
    expect(getWholesaleDiscount(200)).toBe(0.6)
    expect(getWholesaleDiscount(500)).toBe(0.6)
    expect(getWholesaleDiscount(1000)).toBe(0.6)
  })
})

// =============================================================================
// White-Label Pricing
// =============================================================================

describe('WHITE_LABEL_PRICING', () => {
  it('defines pricing for all tiers', () => {
    expect(WHITE_LABEL_PRICING.branded).toBe(49900)           // $499/mo
    expect(WHITE_LABEL_PRICING.full).toBe(299900)              // $2,999/mo
    expect(WHITE_LABEL_PRICING.enterprise_oem).toBeNull()       // Custom pricing
  })
})

// =============================================================================
// White-Label Feature Sets
// =============================================================================

describe('WHITE_LABEL_FEATURES', () => {
  it('branded tier includes basic features', () => {
    const features = WHITE_LABEL_FEATURES.branded
    expect(features).toContain('custom-logo')
    expect(features).toContain('custom-colors')
    expect(features).toContain('custom-favicon')
    expect(features).toContain('custom-dashboard-domain')
    expect(features).toContain('remove-powered-by')
    expect(features).toContain('custom-email-sender')
    expect(features).toContain('custom-docs-domain')
    // Should NOT include advanced features
    expect(features).not.toContain('custom-agent-branding')
    expect(features).not.toContain('dedicated-infrastructure')
  })

  it('full tier includes all branded features plus more', () => {
    const branded = WHITE_LABEL_FEATURES.branded
    const full = WHITE_LABEL_FEATURES.full

    // All branded features included in full
    for (const feature of branded) {
      expect(full).toContain(feature)
    }

    // Plus additional features
    expect(full).toContain('custom-agent-branding')
    expect(full).toContain('custom-widget')
    expect(full).toContain('custom-api-domain')
    expect(full).toContain('custom-legal')
    expect(full).toContain('dedicated-support-channel')

    // Should NOT include enterprise-only features
    expect(full).not.toContain('dedicated-infrastructure')
  })

  it('enterprise_oem tier includes all features', () => {
    const full = WHITE_LABEL_FEATURES.full
    const enterprise = WHITE_LABEL_FEATURES.enterprise_oem

    // All full features included in enterprise
    for (const feature of full) {
      expect(enterprise).toContain(feature)
    }

    // Plus enterprise-only features
    expect(enterprise).toContain('dedicated-infrastructure')
    expect(enterprise).toContain('custom-feature-development')
    expect(enterprise).toContain('priority-roadmap')
    expect(enterprise).toContain('co-marketing')
    expect(enterprise).toContain('revenue-share')
  })

  it('feature sets are progressively larger', () => {
    expect(WHITE_LABEL_FEATURES.branded.length).toBeLessThan(WHITE_LABEL_FEATURES.full.length)
    expect(WHITE_LABEL_FEATURES.full.length).toBeLessThan(WHITE_LABEL_FEATURES.enterprise_oem.length)
  })
})

// =============================================================================
// Wholesale Discount Tiers
// =============================================================================

describe('WHOLESALE_DISCOUNT_TIERS', () => {
  it('defines three tiers', () => {
    expect(WHOLESALE_DISCOUNT_TIERS).toHaveLength(3)
  })

  it('tiers are ordered by minSubOrgs', () => {
    for (let i = 1; i < WHOLESALE_DISCOUNT_TIERS.length; i++) {
      expect(WHOLESALE_DISCOUNT_TIERS[i].minSubOrgs).toBeGreaterThan(
        WHOLESALE_DISCOUNT_TIERS[i - 1].minSubOrgs,
      )
    }
  })

  it('discounts increase with volume', () => {
    for (let i = 1; i < WHOLESALE_DISCOUNT_TIERS.length; i++) {
      expect(WHOLESALE_DISCOUNT_TIERS[i].discount).toBeGreaterThan(
        WHOLESALE_DISCOUNT_TIERS[i - 1].discount,
      )
    }
  })
})

// =============================================================================
// Type Contracts (compile-time safety checks via type assertions)
// =============================================================================

describe('Type contracts', () => {
  it('WhiteLabelConfig has all required fields', () => {
    const config: WhiteLabelConfig = {
      logo: { light: '/logo-light.png', dark: '/logo-dark.png', favicon: '/favicon.ico' },
      colors: {
        primary: '#FF5733',
        secondary: '#3355FF',
        accent: '#33FF57',
        background: '#FFFFFF',
        text: '#000000',
      },
      fonts: { heading: 'Inter', body: 'Roboto' },
      hidePoweredBy: true,
    }

    expect(config.logo.light).toBe('/logo-light.png')
    expect(config.colors.primary).toBe('#FF5733')
    expect(config.fonts.heading).toBe('Inter')
    expect(config.hidePoweredBy).toBe(true)
  })

  it('WhiteLabelConfig supports optional domain fields', () => {
    const config: WhiteLabelConfig = {
      logo: { light: '', dark: '', favicon: '' },
      colors: { primary: '', secondary: '', accent: '', background: '', text: '' },
      fonts: { heading: '', body: '' },
      hidePoweredBy: false,
      dashboardDomain: 'dashboard.partner.com',
      apiDomain: 'api.partner.com',
      docsDomain: 'docs.partner.com',
      statusDomain: 'status.partner.com',
      emailSender: { name: 'Partner', email: 'noreply@partner.com', replyTo: 'support@partner.com' },
      termsUrl: 'https://partner.com/terms',
      privacyUrl: 'https://partner.com/privacy',
      companyName: 'Partner Inc.',
      supportEmail: 'support@partner.com',
      customSignupFields: [
        { name: 'company', label: 'Company Name', type: 'text', required: true },
      ],
      customDashboardLinks: [
        { label: 'Help Center', url: 'https://help.partner.com', position: 'sidebar' },
      ],
    }

    expect(config.dashboardDomain).toBe('dashboard.partner.com')
    expect(config.emailSender?.email).toBe('noreply@partner.com')
    expect(config.customSignupFields).toHaveLength(1)
    expect(config.customDashboardLinks).toHaveLength(1)
  })

  it('CreateResellerInput requires minimal fields', () => {
    const input: CreateResellerInput = {
      orgId: 'org-123',
      tier: 'branded',
      config: {
        logo: { light: '', dark: '', favicon: '' },
        colors: { primary: '', secondary: '', accent: '', background: '', text: '' },
        fonts: { heading: '', body: '' },
        hidePoweredBy: false,
      },
    }

    expect(input.orgId).toBe('org-123')
    expect(input.tier).toBe('branded')
  })

  it('CreateSubOrgInput requires reseller and org identifiers', () => {
    const input: CreateSubOrgInput = {
      resellerId: 'reseller-123',
      parentOrgId: 'org-parent',
      name: 'Customer Corp',
      slug: 'customer-corp',
    }

    expect(input.resellerId).toBe('reseller-123')
    expect(input.parentOrgId).toBe('org-parent')
    expect(input.name).toBe('Customer Corp')
    expect(input.slug).toBe('customer-corp')
  })

  it('DnsRecord has correct structure', () => {
    const record: DnsRecord = {
      type: 'CNAME',
      name: 'dashboard.partner.com',
      value: 'proxy.xspaceagent.com',
    }

    expect(record.type).toBe('CNAME')
    expect(record.name).toBe('dashboard.partner.com')
    expect(record.value).toBe('proxy.xspaceagent.com')
  })

  it('StartImpersonationInput has required fields', () => {
    const input: StartImpersonationInput = {
      resellerId: 'reseller-123',
      adminUserId: 'admin-user',
      targetOrgId: 'target-org',
      durationMinutes: 60,
    }

    expect(input.resellerId).toBe('reseller-123')
    expect(input.durationMinutes).toBe(60)
  })

  it('ResellerBillingSummary has pricing details', () => {
    const summary: ResellerBillingSummary = {
      resellerId: 'reseller-123',
      period: { start: new Date('2026-03-01'), end: new Date('2026-03-31') },
      subOrgCount: 25,
      wholesaleDiscount: 0.4,
      totalUsage: [
        { metric: 'tokens_used', quantity: 1_000_000, wholesaleCostCents: 6000 },
        { metric: 'session_minutes', quantity: 5000, wholesaleCostCents: 3000 },
      ],
      totalCostCents: 9000,
    }

    expect(summary.subOrgCount).toBe(25)
    expect(summary.wholesaleDiscount).toBe(0.4)
    expect(summary.totalUsage).toHaveLength(2)
  })

  it('ResellerAnalytics provides aggregate metrics', () => {
    const analytics: ResellerAnalytics = {
      resellerId: 'reseller-123',
      subOrgCount: 30,
      activeSubOrgs: 28,
      totalAgents: 150,
      totalSessions: 5000,
      totalUsageMinutes: 25000,
      revenueEstimateCents: 500000,
    }

    expect(analytics.activeSubOrgs).toBeLessThanOrEqual(analytics.subOrgCount)
    expect(analytics.totalAgents).toBe(150)
  })
})

// =============================================================================
// White-Label Tier validation
// =============================================================================

describe('White-label tier validation', () => {
  const tiers: WhiteLabelTier[] = ['branded', 'full', 'enterprise_oem']

  it('all tiers have pricing defined', () => {
    for (const tier of tiers) {
      expect(tier in WHITE_LABEL_PRICING).toBe(true)
    }
  })

  it('all tiers have features defined', () => {
    for (const tier of tiers) {
      expect(tier in WHITE_LABEL_FEATURES).toBe(true)
      expect(WHITE_LABEL_FEATURES[tier].length).toBeGreaterThan(0)
    }
  })

  it('non-enterprise tiers have numeric pricing', () => {
    expect(typeof WHITE_LABEL_PRICING.branded).toBe('number')
    expect(typeof WHITE_LABEL_PRICING.full).toBe('number')
  })
})


