// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

// =============================================================================
// Multi-Tenant Types — Organizations, Plans, Quotas, Feature Flags
// =============================================================================

/** Unique identifier for an organization (UUID v4). */
export type OrgId = string;

/** Unique identifier for a user within an organization (UUID v4). */
export type UserId = string;

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/** Available subscription plan tiers. */
export type PlanTier = 'free' | 'developer' | 'pro' | 'business' | 'enterprise';

/** Plan definition with quotas, features, and pricing. */
export interface Plan {
  /** Plan tier identifier. */
  tier: PlanTier;
  /** Maximum number of agents an org can create. */
  maxAgents: number;
  /** Maximum concurrent active sessions. */
  maxConcurrentSessions: number;
  /** Maximum session minutes per billing period. */
  maxSessionMinutesPerMonth: number;
  /** Maximum API calls per minute (rate limit). */
  maxApiCallsPerMinute: number;
  /** Features included in this plan. */
  features: string[];
  /** Data retention in days (Infinity for unlimited). */
  retentionDays: number;
  /** Support level. */
  support: 'community' | 'email' | 'priority' | 'dedicated' | 'dedicated-tam';
  /** Monthly base price in cents (null = custom pricing). */
  price: number | null;
}

// ---------------------------------------------------------------------------
// Quotas
// ---------------------------------------------------------------------------

/** Runtime quota state for an organization. */
export interface Quotas {
  /** Max agents allowed. */
  maxAgents: number;
  /** Current number of agents. */
  currentAgents: number;
  /** Max concurrent sessions allowed. */
  maxConcurrentSessions: number;
  /** Current active sessions. */
  currentSessions: number;
  /** Max session minutes per month. */
  maxSessionMinutesPerMonth: number;
  /** Minutes used this billing period. */
  usedSessionMinutes: number;
  /** Max API calls per minute. */
  maxApiCallsPerMinute: number;
}

// ---------------------------------------------------------------------------
// Feature Flags
// ---------------------------------------------------------------------------

/** Feature flag map — keys are feature names, values indicate enabled/disabled. */
export interface FeatureFlags {
  /** Check if a feature is enabled. */
  isEnabled(feature: string): boolean;
  /** Get all enabled features. */
  enabled(): string[];
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

/** Organization status. */
export type OrgStatus = 'active' | 'suspended' | 'pending' | 'deleted';

/** Suspension reason when an org is suspended. */
export type SuspensionReason = 'non_payment' | 'abuse' | 'tos_violation' | 'manual';

/** An organization (tenant) record. */
export interface Organization {
  /** Unique org identifier (UUID). */
  id: OrgId;
  /** Display name. */
  name: string;
  /** URL-safe slug for subdomain routing (e.g., "acme" -> acme.xspaceagent.com). */
  slug: string;
  /** Owner user ID. */
  ownerId: UserId;
  /** Current subscription plan tier. */
  plan: PlanTier;
  /** Organization status. */
  status: OrgStatus;
  /** Suspension reason (only set when status is 'suspended'). */
  suspensionReason?: SuspensionReason;
  /** Stripe customer ID for billing. */
  stripeCustomerId?: string;
  /** Custom domain (Enterprise only). */
  customDomain?: string;
  /** Creation timestamp. */
  createdAt: Date;
  /** Last update timestamp. */
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Users & Roles
// ---------------------------------------------------------------------------

/** Role within an organization (hierarchical: owner > admin > manager > developer > viewer). */
export type OrgRole = 'owner' | 'admin' | 'manager' | 'developer' | 'member' | 'viewer';

/** A user's membership in an organization. */
export interface OrgMember {
  /** User ID. */
  userId: UserId;
  /** Organization ID. */
  orgId: OrgId;
  /** Built-in role within the org. */
  role: OrgRole;
  /** Custom role ID (Enterprise only, overrides built-in role permissions). */
  customRoleId?: string;
  /** Email address. */
  email: string;
  /** Display name. */
  name?: string;
  /** User who invited this member. */
  invitedBy?: UserId;
  /** When the user joined this org. */
  joinedAt: Date;
}

/** A custom role definition (Enterprise only). */
export interface CustomRole {
  /** Unique ID. */
  id: string;
  /** Organization this role belongs to. */
  orgId: OrgId;
  /** Role display name. */
  name: string;
  /** Human-readable description. */
  description?: string;
  /** Granted permission scopes. */
  permissions: string[];
  /** When the role was created. */
  createdAt: Date;
}

/** Invitation status. */
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

/** A pending or resolved invitation to an organization. */
export interface Invitation {
  /** Unique ID. */
  id: string;
  /** Organization this invitation is for. */
  orgId: OrgId;
  /** Invitee email address. */
  email: string;
  /** Role to assign upon acceptance. */
  role: OrgRole;
  /** User who sent the invitation. */
  invitedBy: UserId;
  /** Hashed invite token. */
  tokenHash: string;
  /** Current status. */
  status: InvitationStatus;
  /** When the invitation expires. */
  expiresAt: Date;
  /** When the invitation was created. */
  createdAt: Date;
}

/** A team within an organization (for grouping members). */
export interface Team {
  /** Unique ID. */
  id: string;
  /** Organization this team belongs to. */
  orgId: OrgId;
  /** Team display name. */
  name: string;
  /** Team description. */
  description?: string;
  /** Member user IDs in this team. */
  memberIds: UserId[];
  /** When the team was created. */
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

/** An API key belonging to an organization. */
export interface ApiKey {
  /** Key ID (public, used for lookups). */
  id: string;
  /** Hashed key value (never stored in plaintext). */
  hashedKey: string;
  /** Key prefix shown to users (e.g., "xsa_...abc"). */
  prefix: string;
  /** Organization this key belongs to. */
  orgId: OrgId;
  /** User who created the key. */
  createdBy: UserId;
  /** Human-readable label. */
  name: string;
  /** Scopes/permissions granted to this key. */
  scopes: string[];
  /** When the key was created. */
  createdAt: Date;
  /** Optional expiration date. */
  expiresAt?: Date;
  /** Last time this key was used. */
  lastUsedAt?: Date;
}

// ---------------------------------------------------------------------------
// Tenant Context (injected into every request)
// ---------------------------------------------------------------------------

/** Tenant context resolved from the incoming request. */
export interface TenantContext {
  /** Organization ID. */
  orgId: OrgId;
  /** Authenticated user ID (absent for API-key-only requests). */
  userId?: UserId;
  /** User's role in the organization (absent for API-key-only requests). */
  userRole?: OrgRole;
  /** Custom permissions from a custom role (Enterprise). */
  customPermissions?: string[];
  /** The organization's current plan. */
  plan: Plan;
  /** Current quota state. */
  quotas: Quotas;
  /** Feature flags for this tenant. */
  features: FeatureFlags;
  /** The full organization record. */
  org: Organization;
}

// ---------------------------------------------------------------------------
// Tenant Events
// ---------------------------------------------------------------------------

/** Events emitted during organization lifecycle. */
export interface TenantEvent {
  type:
    | 'org.created'
    | 'org.updated'
    | 'org.suspended'
    | 'org.reactivated'
    | 'org.deleted'
    | 'member.added'
    | 'member.removed'
    | 'plan.changed'
    | 'quota.exceeded';
  orgId: OrgId;
  userId?: UserId;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}


