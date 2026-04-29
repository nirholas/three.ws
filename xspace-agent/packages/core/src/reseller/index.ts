// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

// =============================================================================
// Reseller — Re-exports
// =============================================================================

export { ResellerService } from './reseller-service'
export { CustomDomainService } from './custom-domain-service'
export { ImpersonationService } from './impersonation-service'

export type {
  WhiteLabelTier,
  WhiteLabelConfig,
  LogoConfig,
  ColorConfig,
  FontConfig,
  EmailSenderConfig,
  CustomField,
  CustomLink,
  ResellerStatus,
  Reseller,
  CreateResellerInput,
  SubOrgStatus,
  SubOrganization,
  CreateSubOrgInput,
  DomainStatus,
  CustomDomain,
  DnsRecord,
  CreateCustomDomainInput,
  AgentTemplate,
  CreateAgentTemplateInput,
  ImpersonationSession,
  StartImpersonationInput,
  WholesaleDiscountTier,
  ResellerBillingSummary,
  ResellerAnalytics,
} from './types'

export {
  WHITE_LABEL_PRICING,
  WHITE_LABEL_FEATURES,
  WHOLESALE_DISCOUNT_TIERS,
  getWholesaleDiscount,
} from './types'


