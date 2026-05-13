// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

// =============================================================================
// Organization Lifecycle Service
// =============================================================================

import { randomUUID } from 'crypto';
import type {
  Organization,
  OrgId,
  UserId,
  OrgMember,
  OrgStatus,
  PlanTier,
  SuspensionReason,
  ApiKey,
  TenantEvent,
  Quotas,
} from './types';
import { getPlan, getDefaultQuotas } from './plans';
import { createFeatureFlags } from './feature-flags';

// ---------------------------------------------------------------------------
// In-memory stores (replaced by PostgreSQL in Phase 01)
// ---------------------------------------------------------------------------

const organizations = new Map<OrgId, Organization>();
const members = new Map<OrgId, OrgMember[]>();
const apiKeys = new Map<string, ApiKey>(); // keyed by hashed key
const apiKeysByOrg = new Map<OrgId, ApiKey[]>();
const orgsBySlug = new Map<string, OrgId>();
const eventLog: TenantEvent[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63);
}

function generateApiKeyValue(): { raw: string; prefix: string; hashed: string } {
  const raw = `xsa_${randomUUID().replace(/-/g, '')}`;
  const prefix = `${raw.slice(0, 8)}...${raw.slice(-4)}`;
  // In production, use bcrypt/argon2. For now, simple hash placeholder.
  const hashed = Buffer.from(raw).toString('base64');
  return { raw, prefix, hashed };
}

function emitEvent(event: TenantEvent): void {
  eventLog.push(event);
}

// ---------------------------------------------------------------------------
// Organization CRUD
// ---------------------------------------------------------------------------

export interface CreateOrganizationInput {
  name: string;
  ownerEmail: string;
  ownerName?: string;
  plan?: PlanTier;
  slug?: string;
}

export interface CreateOrganizationResult {
  org: Organization;
  owner: OrgMember;
  apiKey: { key: ApiKey; rawValue: string };
}

/**
 * Provision a new organization (tenant).
 *
 * Creates:
 * - Organization record
 * - Owner user with 'owner' role
 * - Default API key
 * - Initializes quotas based on plan
 */
export function createOrganization(input: CreateOrganizationInput): CreateOrganizationResult {
  const orgId = randomUUID();
  const ownerId = randomUUID();
  const plan = input.plan ?? 'free';
  const slug = input.slug ?? slugify(input.name);

  // Ensure slug uniqueness
  if (orgsBySlug.has(slug)) {
    throw new Error(`Organization slug "${slug}" is already taken`);
  }

  const now = new Date();

  const org: Organization = {
    id: orgId,
    name: input.name,
    slug,
    ownerId,
    plan,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  const owner: OrgMember = {
    userId: ownerId,
    orgId,
    role: 'owner',
    email: input.ownerEmail,
    name: input.ownerName,
    joinedAt: now,
  };

  const { raw, prefix, hashed } = generateApiKeyValue();
  const apiKey: ApiKey = {
    id: randomUUID(),
    hashedKey: hashed,
    prefix,
    orgId,
    createdBy: ownerId,
    name: 'Default API Key',
    scopes: ['*'],
    createdAt: now,
  };

  // Persist
  organizations.set(orgId, org);
  members.set(orgId, [owner]);
  apiKeys.set(hashed, apiKey);
  apiKeysByOrg.set(orgId, [apiKey]);
  orgsBySlug.set(slug, orgId);

  emitEvent({
    type: 'org.created',
    orgId,
    userId: ownerId,
    timestamp: now,
    metadata: { plan, slug },
  });

  return { org, owner, apiKey: { key: apiKey, rawValue: raw } };
}

/**
 * Full tenant teardown.
 *
 * - Archives data (in production: mark for 30-day retention)
 * - Removes all org data from in-memory stores
 * - Audit logs the deletion
 */
export function deleteOrganization(orgId: OrgId): void {
  const org = organizations.get(orgId);
  if (!org) {
    throw new Error(`Organization ${orgId} not found`);
  }

  // Remove API keys
  const orgKeys = apiKeysByOrg.get(orgId) ?? [];
  for (const key of orgKeys) {
    apiKeys.delete(key.hashedKey);
  }
  apiKeysByOrg.delete(orgId);

  // Remove slug mapping
  orgsBySlug.delete(org.slug);

  // Remove members
  members.delete(orgId);

  // Mark as deleted (retain record for audit)
  org.status = 'deleted';
  org.updatedAt = new Date();

  emitEvent({
    type: 'org.deleted',
    orgId,
    userId: org.ownerId,
    timestamp: new Date(),
  });
}

/**
 * Suspend an organization for non-payment, abuse, or TOS violation.
 *
 * - Blocks API access (middleware returns 402/403)
 * - Running agents should be paused by the caller
 */
export function suspendOrganization(orgId: OrgId, reason: SuspensionReason): void {
  const org = organizations.get(orgId);
  if (!org) {
    throw new Error(`Organization ${orgId} not found`);
  }
  if (org.status === 'suspended') {
    throw new Error(`Organization ${orgId} is already suspended`);
  }

  org.status = 'suspended';
  org.suspensionReason = reason;
  org.updatedAt = new Date();

  emitEvent({
    type: 'org.suspended',
    orgId,
    timestamp: new Date(),
    metadata: { reason },
  });
}

/**
 * Reactivate a previously suspended organization.
 */
export function reactivateOrganization(orgId: OrgId): void {
  const org = organizations.get(orgId);
  if (!org) {
    throw new Error(`Organization ${orgId} not found`);
  }
  if (org.status !== 'suspended') {
    throw new Error(`Organization ${orgId} is not suspended (current: ${org.status})`);
  }

  org.status = 'active';
  org.suspensionReason = undefined;
  org.updatedAt = new Date();

  emitEvent({
    type: 'org.reactivated',
    orgId,
    timestamp: new Date(),
  });
}

/**
 * Change an organization's subscription plan.
 */
export function changePlan(orgId: OrgId, newTier: PlanTier): void {
  const org = organizations.get(orgId);
  if (!org) {
    throw new Error(`Organization ${orgId} not found`);
  }

  const oldTier = org.plan;
  // Validate the new tier exists
  getPlan(newTier);

  org.plan = newTier;
  org.updatedAt = new Date();

  emitEvent({
    type: 'plan.changed',
    orgId,
    timestamp: new Date(),
    metadata: { from: oldTier, to: newTier },
  });
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** Get an organization by ID. */
export function getOrganization(orgId: OrgId): Organization | undefined {
  return organizations.get(orgId);
}

/** Get an organization by slug (for subdomain routing). */
export function getOrganizationBySlug(slug: string): Organization | undefined {
  const orgId = orgsBySlug.get(slug);
  return orgId ? organizations.get(orgId) : undefined;
}

/** Resolve an API key to its organization. Returns undefined if key is invalid/expired. */
export function resolveApiKey(rawKey: string): { org: Organization; apiKey: ApiKey } | undefined {
  const hashed = Buffer.from(rawKey).toString('base64');
  const key = apiKeys.get(hashed);
  if (!key) return undefined;

  // Check expiration
  if (key.expiresAt && key.expiresAt < new Date()) {
    return undefined;
  }

  const org = organizations.get(key.orgId);
  if (!org) return undefined;

  // Update last used timestamp
  key.lastUsedAt = new Date();

  return { org, apiKey: key };
}

/** Get all members of an organization. */
export function getOrgMembers(orgId: OrgId): OrgMember[] {
  return members.get(orgId) ?? [];
}

/** Get the current quotas for an organization. */
export function getOrgQuotas(orgId: OrgId): Quotas {
  const org = organizations.get(orgId);
  if (!org) {
    throw new Error(`Organization ${orgId} not found`);
  }
  // In production, currentAgents/currentSessions come from live state.
  // For now, return defaults from the plan.
  return getDefaultQuotas(org.plan);
}

/** Get all API keys for an organization (metadata only, no raw values). */
export function getOrgApiKeys(orgId: OrgId): ApiKey[] {
  return apiKeysByOrg.get(orgId) ?? [];
}

/** Get recent tenant events (for audit log). */
export function getTenantEvents(orgId?: OrgId, limit = 50): TenantEvent[] {
  const events = orgId
    ? eventLog.filter((e) => e.orgId === orgId)
    : eventLog;
  return events.slice(-limit);
}

// ---------------------------------------------------------------------------
// Member Management
// ---------------------------------------------------------------------------

export interface AddMemberInput {
  orgId: OrgId;
  email: string;
  name?: string;
  role?: 'admin' | 'member' | 'viewer';
}

/** Add a member to an organization. */
export function addMember(input: AddMemberInput): OrgMember {
  const org = organizations.get(input.orgId);
  if (!org) {
    throw new Error(`Organization ${input.orgId} not found`);
  }

  const orgMembers = members.get(input.orgId) ?? [];
  if (orgMembers.some((m) => m.email === input.email)) {
    throw new Error(`Member with email ${input.email} already exists in org ${input.orgId}`);
  }

  const member: OrgMember = {
    userId: randomUUID(),
    orgId: input.orgId,
    role: input.role ?? 'member',
    email: input.email,
    name: input.name,
    joinedAt: new Date(),
  };

  orgMembers.push(member);
  members.set(input.orgId, orgMembers);

  emitEvent({
    type: 'member.added',
    orgId: input.orgId,
    userId: member.userId,
    timestamp: new Date(),
    metadata: { email: input.email, role: member.role },
  });

  return member;
}

/** Remove a member from an organization. Cannot remove the owner. */
export function removeMember(orgId: OrgId, userId: UserId): void {
  const org = organizations.get(orgId);
  if (!org) {
    throw new Error(`Organization ${orgId} not found`);
  }
  if (org.ownerId === userId) {
    throw new Error('Cannot remove the organization owner');
  }

  const orgMembers = members.get(orgId) ?? [];
  const idx = orgMembers.findIndex((m) => m.userId === userId);
  if (idx === -1) {
    throw new Error(`User ${userId} is not a member of org ${orgId}`);
  }

  orgMembers.splice(idx, 1);

  emitEvent({
    type: 'member.removed',
    orgId,
    userId,
    timestamp: new Date(),
  });
}

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

/** Reset all in-memory stores. For testing only. */
export function __resetStores(): void {
  organizations.clear();
  members.clear();
  apiKeys.clear();
  apiKeysByOrg.clear();
  orgsBySlug.clear();
  eventLog.length = 0;
}


