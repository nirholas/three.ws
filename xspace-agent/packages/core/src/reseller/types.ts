// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§87]

// =============================================================================
// White-Label & Reseller Types
// =============================================================================

import type { OrgId, UserId } from '../tenant/types'

// ---------------------------------------------------------------------------
// White-Label Tiers
// ---------------------------------------------------------------------------

/** Available white-label tier levels. */
export type WhiteLabelTier = 'branded' | 'full' | 'enterprise_oem'

/** Monthly pricing per tier in cents. */
export const WHITE_LABEL_PRICING: Record<WhiteLabelTier, number | null> = {
  branded: 49900,        // $499/mo
  full: 299900,          // $2,999/mo
  enterprise_oem: null,  // $9,999+/mo — custom pricing
}

/** Features available per tier. */
export const WHITE_LABEL_FEATURES: Record<WhiteLabelTier, string[]> = {
  branded: [
    'custom-logo',
    'custom-colors',
    'custom-favicon',
    'custom-dashboard-domain',
    'remove-powered-by',
    'custom-email-sender',
    'custom-docs-domain',
  ],
  full: [
    'custom-logo',
    'custom-colors',
    'custom-favicon',
    'custom-dashboard-domain',
    'remove-powered-by',
    'custom-email-sender',
    'custom-docs-domain',
    'custom-agent-branding',
    'custom-widget',
    'custom-api-domain',
    'custom-legal',
    'dedicated-support-channel',
  ],
  enterprise_oem: [
    'custom-logo',
    'custom-colors',
    'custom-favicon',
    'custom-dashboard-domain',
    'remove-powered-by',
    'custom-email-sender',
    'custom-docs-domain',
    'custom-agent-branding',
    'custom-widget',
    'custom-api-domain',
    'custom-legal',
    'dedicated-support-channel',
    'dedicated-infrastructure',
    'custom-feature-development',
    'priority-roadmap',
    'co-marketing',
    'revenue-share',
  ],
}

// ---------------------------------------------------------------------------
// Branding Configuration
// ---------------------------------------------------------------------------

/** Logo configuration for light and dark modes. */
export interface LogoConfig {
  light: string
  dark: string
  favicon: string
}

/** Color palette for branded dashboard. */
export interface ColorConfig {
  primary: string
  secondary: string
  accent: string
  background: string
  text: string
}

/** Font configuration. */
export interface FontConfig {
  heading: string
  body: string
}

/** Email sender configuration. */
export interface EmailSenderConfig {
  name: string
  email: string
  replyTo: string
}

/** Full white-label branding configuration. */
export interface WhiteLabelConfig {
  // Visual
  logo: LogoConfig
  colors: ColorConfig
  fonts: FontConfig

  // Domains
  dashboardDomain?: string
  apiDomain?: string
  docsDomain?: string
  statusDomain?: string

  // Email
  emailSender?: EmailSenderConfig
  emailTemplates?: Record<string, string>

  // Legal
  termsUrl?: string
  privacyUrl?: string
  companyName?: string
  supportEmail?: string

  // Feature toggles
  hidePoweredBy: boolean
  customSignupFields?: CustomField[]
  customDashboardLinks?: CustomLink[]
}

/** Custom signup field for white-label sign-up forms. */
export interface CustomField {
  name: string
  label: string
  type: 'text' | 'email' | 'select' | 'checkbox'
  required: boolean
  options?: string[]
}

/** Custom link in the white-label dashboard. */
export interface CustomLink {
  label: string
  url: string
  icon?: string
  position: 'sidebar' | 'header' | 'footer'
}

// ---------------------------------------------------------------------------
// Reseller
// ---------------------------------------------------------------------------

/** Reseller status. */
export type ResellerStatus = 'active' | 'suspended' | 'pending' | 'churned'

/** A reseller (white-label partner) record. */
export interface Reseller {
  id: string
  orgId: OrgId
  tier: WhiteLabelTier
  status: ResellerStatus
  config: WhiteLabelConfig
  wholesaleDiscount: number // 0.0-1.0 (e.g., 0.4 = 40%)
  maxSubOrgs: number
  createdAt: Date
  updatedAt: Date
}

/** Input for creating a reseller. */
export interface CreateResellerInput {
  orgId: OrgId
  tier: WhiteLabelTier
  config: WhiteLabelConfig
  maxSubOrgs?: number
}

// ---------------------------------------------------------------------------
// Sub-Organizations
// ---------------------------------------------------------------------------

/** Sub-organization status. */
export type SubOrgStatus = 'active' | 'suspended' | 'pending'

/** A sub-organization under a reseller. */
export interface SubOrganization {
  id: string
  resellerId: string
  parentOrgId: OrgId
  orgId: OrgId
  name: string
  slug: string
  status: SubOrgStatus
  plan: string
  settings: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

/** Input for creating a sub-organization. */
export interface CreateSubOrgInput {
  resellerId: string
  parentOrgId: OrgId
  name: string
  slug: string
  plan?: string
  settings?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Custom Domains
// ---------------------------------------------------------------------------

/** DNS verification status. */
export type DomainStatus = 'pending_verification' | 'dns_verified' | 'tls_provisioning' | 'active' | 'failed'

/** Custom domain record. */
export interface CustomDomain {
  id: string
  resellerId: string
  orgId: OrgId
  domain: string
  type: 'dashboard' | 'api' | 'docs' | 'status'
  status: DomainStatus
  dnsRecord: DnsRecord
  tlsCertificateId?: string
  verifiedAt?: Date
  createdAt: Date
  updatedAt: Date
}

/** DNS record required for domain verification. */
export interface DnsRecord {
  type: 'CNAME' | 'A'
  name: string
  value: string
}

/** Input for creating a custom domain. */
export interface CreateCustomDomainInput {
  resellerId: string
  orgId: OrgId
  domain: string
  type: 'dashboard' | 'api' | 'docs' | 'status'
}

// ---------------------------------------------------------------------------
// Agent Templates
// ---------------------------------------------------------------------------

/** A syndicated agent template from a reseller. */
export interface AgentTemplate {
  id: string
  resellerId: string
  name: string
  description?: string
  config: Record<string, unknown>
  isDefault: boolean
  targetSubOrgs: string[] // empty = all sub-orgs
  createdAt: Date
  updatedAt: Date
}

/** Input for creating an agent template. */
export interface CreateAgentTemplateInput {
  resellerId: string
  name: string
  description?: string
  config: Record<string, unknown>
  isDefault?: boolean
  targetSubOrgs?: string[]
}

// ---------------------------------------------------------------------------
// Impersonation
// ---------------------------------------------------------------------------

/** An active impersonation session. */
export interface ImpersonationSession {
  id: string
  resellerId: string
  adminUserId: UserId
  targetOrgId: OrgId
  targetUserId?: UserId
  expiresAt: Date
  createdAt: Date
}

/** Input for starting an impersonation session. */
export interface StartImpersonationInput {
  resellerId: string
  adminUserId: UserId
  targetOrgId: OrgId
  targetUserId?: UserId
  durationMinutes?: number // default 60
}

// ---------------------------------------------------------------------------
// Wholesale Billing
// ---------------------------------------------------------------------------

/** Wholesale discount tier based on sub-org count. */
export interface WholesaleDiscountTier {
  minSubOrgs: number
  discount: number // 0.0-1.0
}

/** Default wholesale discount tiers. */
export const WHOLESALE_DISCOUNT_TIERS: WholesaleDiscountTier[] = [
  { minSubOrgs: 0, discount: 0.4 },    // Base: 40% discount
  { minSubOrgs: 50, discount: 0.5 },   // 50+ sub-orgs: 50% discount
  { minSubOrgs: 200, discount: 0.6 },  // 200+ sub-orgs: 60% discount
]

/** Calculate wholesale discount based on sub-org count. */
export function getWholesaleDiscount(subOrgCount: number): number {
  let discount = WHOLESALE_DISCOUNT_TIERS[0].discount
  for (const tier of WHOLESALE_DISCOUNT_TIERS) {
    if (subOrgCount >= tier.minSubOrgs) {
      discount = tier.discount
    }
  }
  return discount
}

/** Reseller billing summary. */
export interface ResellerBillingSummary {
  resellerId: string
  period: { start: Date; end: Date }
  subOrgCount: number
  wholesaleDiscount: number
  totalUsage: {
    metric: string
    quantity: number
    wholesaleCostCents: number
  }[]
  totalCostCents: number
}

/** Reseller analytics. */
export interface ResellerAnalytics {
  resellerId: string
  subOrgCount: number
  activeSubOrgs: number
  totalAgents: number
  totalSessions: number
  totalUsageMinutes: number
  revenueEstimateCents: number
}


