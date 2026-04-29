// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Multi-Tenant Module — Public Exports
// =============================================================================

// Types
export type {
  OrgId,
  UserId,
  PlanTier,
  Plan,
  Quotas,
  FeatureFlags,
  OrgStatus,
  SuspensionReason,
  Organization,
  OrgRole,
  OrgMember,
  CustomRole,
  Invitation,
  InvitationStatus,
  Team,
  ApiKey,
  TenantContext,
  TenantEvent,
} from './types';

// Plans
export { PLANS, getPlan, getDefaultQuotas } from './plans';

// Feature flags
export { createFeatureFlags } from './feature-flags';
export type { FeatureName } from './feature-flags';

// Tenant context (AsyncLocalStorage)
export {
  runWithTenant,
  getTenantContext,
  getTenantContextOrNull,
  getCurrentOrgId,
} from './context';

// Organization lifecycle
export {
  createOrganization,
  deleteOrganization,
  suspendOrganization,
  reactivateOrganization,
  changePlan,
  getOrganization,
  getOrganizationBySlug,
  resolveApiKey,
  getOrgMembers,
  getOrgQuotas,
  getOrgApiKeys,
  getTenantEvents,
  addMember,
  removeMember,
} from './organization';
export type {
  CreateOrganizationInput,
  CreateOrganizationResult,
  AddMemberInput,
} from './organization';

// Quota enforcement
export { QuotaEnforcer } from './quota-enforcer';

// Tenant-scoped repository
export { TenantRepository } from './repository';


