// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// Database — Drizzle ORM Schema
// =============================================================================

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  bigint,
  real,
  inet,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Organizations (tenants)
// ---------------------------------------------------------------------------

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  plan: text('plan').notNull().default('free'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  settings: jsonb('settings').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('idx_organizations_slug').on(table.slug),
  index('idx_organizations_stripe').on(table.stripeCustomerId),
])

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').unique().notNull(),
  name: text('name'),
  role: text('role').notNull().default('member'),
  passwordHash: text('password_hash'),
  ssoProvider: text('sso_provider'),
  ssoSubject: text('sso_subject'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('idx_users_email').on(table.email),
])

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  name: text('name').notNull(),
  scopes: text('scopes').array().default([]),
  rateLimit: integer('rate_limit').default(1000),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_api_keys_hash').on(table.keyHash),
])

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  config: jsonb('config').notNull(),
  status: text('status').default('idle'),
  version: integer('version').default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

// ---------------------------------------------------------------------------
// Agent Sessions
// ---------------------------------------------------------------------------

export const agentSessions = pgTable('agent_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
  spaceUrl: text('space_url'),
  platform: text('platform').notNull().default('x-spaces'),
  status: text('status').notNull().default('active'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  durationSeconds: integer('duration_seconds'),
  metadata: jsonb('metadata').default({}),
}, (table) => [
  index('idx_agent_sessions_org').on(table.orgId, table.startedAt),
])

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').references(() => agentSessions.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
  messages: jsonb('messages').default([]),
  summary: text('summary'),
  sentimentAvg: real('sentiment_avg'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ---------------------------------------------------------------------------
// Usage Records (for billing)
// ---------------------------------------------------------------------------

export const usageRecords = pgTable('usage_records', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
  sessionId: uuid('session_id').references(() => agentSessions.id),
  metric: text('metric').notNull(),
  quantity: bigint('quantity', { mode: 'number' }).notNull(),
  unitCostCents: bigint('unit_cost_cents', { mode: 'number' }),
  provider: text('provider'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_usage_records_org_metric').on(table.orgId, table.metric, table.recordedAt),
])

// ---------------------------------------------------------------------------
// Custom Roles (Enterprise RBAC)
// ---------------------------------------------------------------------------

export const customRoles = pgTable('custom_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  permissions: text('permissions').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_custom_roles_org').on(table.orgId),
])

// ---------------------------------------------------------------------------
// Organization Members (RBAC)
// ---------------------------------------------------------------------------

export const orgMembers = pgTable('org_members', {
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull().default('viewer'),
  customRoleId: uuid('custom_role_id').references(() => customRoles.id),
  invitedBy: uuid('invited_by').references(() => users.id),
  joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_org_members_org').on(table.orgId),
  index('idx_org_members_user').on(table.userId),
])

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  email: text('email').notNull(),
  role: text('role').notNull(),
  invitedBy: uuid('invited_by').references(() => users.id),
  tokenHash: text('token_hash').notNull(),
  status: text('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_invitations_org').on(table.orgId),
  index('idx_invitations_email').on(table.email),
  index('idx_invitations_token').on(table.tokenHash),
])

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  memberIds: uuid('member_ids').array().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_teams_org').on(table.orgId),
])

// ---------------------------------------------------------------------------
// Audit Logs
// ---------------------------------------------------------------------------

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').references(() => users.id),
  actorType: text('actor_type').notNull().default('user'),
  actorIp: inet('actor_ip'),
  actorUserAgent: text('actor_user_agent'),
  action: text('action').notNull(),
  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id'),
  severity: text('severity').notNull().default('info'),
  details: jsonb('details').default({}),
  changes: jsonb('changes'),
  requestId: text('request_id'),
  geoLocation: jsonb('geo_location'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  prevHash: text('prev_hash'),
  entryHash: text('entry_hash'),
}, (table) => [
  index('idx_audit_logs_org').on(table.orgId, table.createdAt),
  index('idx_audit_actor').on(table.actorId, table.createdAt),
  index('idx_audit_action').on(table.action, table.createdAt),
  index('idx_audit_resource').on(table.resourceType, table.resourceId),
  index('idx_audit_severity').on(table.severity, table.createdAt),
])

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export const webhooks = pgTable('webhooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  events: text('events').array().notNull(),
  active: text('active').notNull().default('true'),
  description: text('description'),
  headers: jsonb('headers').default({}),
  failureCount: integer('failure_count').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_webhooks_org').on(table.orgId),
  index('idx_webhooks_org_active').on(table.orgId, table.active),
])

// ---------------------------------------------------------------------------
// Webhook Deliveries
// ---------------------------------------------------------------------------

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  webhookId: uuid('webhook_id').references(() => webhooks.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').default(0),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  responseStatus: integer('response_status'),
  responseBody: text('response_body'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_webhook_deliveries_webhook').on(table.webhookId),
  index('idx_webhook_deliveries_status').on(table.status, table.nextRetryAt),
])

// ---------------------------------------------------------------------------
// Refresh Tokens
// ---------------------------------------------------------------------------

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  tokenHash: text('token_hash').notNull(),
  familyId: uuid('family_id').notNull(),
  deviceInfo: text('device_info'),
  ipAddress: inet('ip_address'),
  isRevoked: integer('is_revoked').default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_refresh_tokens_user').on(table.userId),
  index('idx_refresh_tokens_hash').on(table.tokenHash),
  index('idx_refresh_tokens_family').on(table.familyId),
])

// ---------------------------------------------------------------------------
// User Sessions
// ---------------------------------------------------------------------------

export const userSessions = pgTable('user_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  refreshTokenId: uuid('refresh_token_id').references(() => refreshTokens.id, { onDelete: 'set null' }),
  deviceInfo: text('device_info'),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  lastActiveAt: timestamp('last_active_at', { withTimezone: true }).defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_user_sessions_user').on(table.userId),
  index('idx_user_sessions_org').on(table.orgId),
])

// ---------------------------------------------------------------------------
// SAML Configurations
// ---------------------------------------------------------------------------

export const samlConfigs = pgTable('saml_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  enabled: integer('enabled').default(0),
  entryPoint: text('entry_point').notNull(),
  issuer: text('issuer').notNull(),
  cert: text('cert').notNull(),
  callbackUrl: text('callback_url').notNull(),
  signatureAlgorithm: text('signature_algorithm').notNull().default('sha256'),
  wantAuthnResponseSigned: integer('want_authn_response_signed').default(1),
  wantAssertionsSigned: integer('want_assertions_signed').default(1),
  emailAttribute: text('email_attribute').notNull().default('email'),
  firstNameAttribute: text('first_name_attribute').notNull().default('firstName'),
  lastNameAttribute: text('last_name_attribute').notNull().default('lastName'),
  groupsAttribute: text('groups_attribute'),
  jitProvisioning: integer('jit_provisioning').default(1),
  defaultRole: text('default_role').notNull().default('member'),
  enforceSSO: integer('enforce_sso').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('idx_saml_configs_org').on(table.orgId),
])

// ---------------------------------------------------------------------------
// OIDC Configurations
// ---------------------------------------------------------------------------

export const oidcConfigs = pgTable('oidc_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  enabled: integer('enabled').default(0),
  issuerUrl: text('issuer_url').notNull(),
  clientId: text('client_id').notNull(),
  clientSecretEncrypted: text('client_secret_encrypted').notNull(),
  scopes: text('scopes').array().default(['openid', 'profile', 'email']),
  callbackUrl: text('callback_url').notNull(),
  emailClaim: text('email_claim').notNull().default('email'),
  nameClaim: text('name_claim').notNull().default('name'),
  groupsClaim: text('groups_claim'),
  jitProvisioning: integer('jit_provisioning').default(1),
  defaultRole: text('default_role').notNull().default('member'),
  enforceSSO: integer('enforce_sso').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('idx_oidc_configs_org').on(table.orgId),
])

// ---------------------------------------------------------------------------
// MFA Secrets
// ---------------------------------------------------------------------------

export const mfaSecrets = pgTable('mfa_secrets', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  secretEncrypted: text('secret_encrypted').notNull(),
  recoveryCodesEncrypted: text('recovery_codes_encrypted').notNull(),
  verified: integer('verified').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('idx_mfa_secrets_user').on(table.userId),
])

// ---------------------------------------------------------------------------
// OAuth Accounts
// ---------------------------------------------------------------------------

export const oauthAccounts = pgTable('oauth_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  provider: text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  email: text('email'),
  displayName: text('display_name'),
  accessTokenEncrypted: text('access_token_encrypted'),
  refreshTokenEncrypted: text('refresh_token_encrypted'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_oauth_accounts_user').on(table.userId),
  uniqueIndex('idx_oauth_accounts_provider').on(table.provider, table.providerAccountId),
])

// ---------------------------------------------------------------------------
// Marketplace Listings
// ---------------------------------------------------------------------------

export const marketplaceListings = pgTable('marketplace_listings', {
  id: uuid('id').primaryKey().defaultRandom(),
  publisherId: uuid('publisher_id').references(() => users.id),
  publisherOrgId: uuid('publisher_org_id').references(() => organizations.id),
  type: text('type').notNull(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  description: text('description').notNull(),
  longDescription: text('long_description'),
  category: text('category').notNull(),
  tags: text('tags').array().default([]),
  iconUrl: text('icon_url'),
  screenshots: text('screenshots').array().default([]),
  demoUrl: text('demo_url'),
  pricingModel: text('pricing_model').notNull(),
  priceCents: integer('price_cents'),
  stripePriceId: text('stripe_price_id'),
  version: text('version').notNull(),
  minPlatformVersion: text('min_platform_version'),
  sourceUrl: text('source_url'),
  documentationUrl: text('documentation_url'),
  supportEmail: text('support_email'),
  manifest: jsonb('manifest').default({}),
  status: text('status').default('draft'),
  reviewNotes: text('review_notes'),
  installCount: integer('install_count').default(0),
  ratingAvg: real('rating_avg').default(0),
  ratingCount: integer('rating_count').default(0),
  featured: integer('featured').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('idx_marketplace_listings_slug').on(table.slug),
  index('idx_marketplace_listings_publisher').on(table.publisherOrgId),
  index('idx_marketplace_listings_type').on(table.type),
  index('idx_marketplace_listings_category').on(table.category),
  index('idx_marketplace_listings_status').on(table.status),
])

// ---------------------------------------------------------------------------
// Marketplace Installs
// ---------------------------------------------------------------------------

export const marketplaceInstalls = pgTable('marketplace_installs', {
  id: uuid('id').primaryKey().defaultRandom(),
  listingId: uuid('listing_id').references(() => marketplaceListings.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
  installedBy: uuid('installed_by').references(() => users.id),
  stripeSubscriptionId: text('stripe_subscription_id'),
  status: text('status').default('active'),
  config: jsonb('config').default({}),
  installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
}, (table) => [
  index('idx_marketplace_installs_listing').on(table.listingId),
  index('idx_marketplace_installs_org').on(table.orgId),
])

// ---------------------------------------------------------------------------
// Marketplace Reviews
// ---------------------------------------------------------------------------

export const marketplaceReviews = pgTable('marketplace_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  listingId: uuid('listing_id').references(() => marketplaceListings.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id),
  orgId: uuid('org_id').references(() => organizations.id),
  rating: integer('rating').notNull(),
  title: text('title'),
  body: text('body'),
  helpfulCount: integer('helpful_count').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_marketplace_reviews_listing').on(table.listingId),
  index('idx_marketplace_reviews_user').on(table.userId),
])

// ---------------------------------------------------------------------------
// Publisher Payouts
// ---------------------------------------------------------------------------

export const publisherPayouts = pgTable('publisher_payouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  publisherOrgId: uuid('publisher_org_id').references(() => organizations.id),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  grossRevenueCents: integer('gross_revenue_cents').notNull().default(0),
  platformFeeCents: integer('platform_fee_cents').notNull().default(0),
  netPayoutCents: integer('net_payout_cents').notNull().default(0),
  stripeTransferId: text('stripe_transfer_id'),
  status: text('status').default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_publisher_payouts_org').on(table.publisherOrgId),
  index('idx_publisher_payouts_status').on(table.status),
])

// ---------------------------------------------------------------------------
// Agent Versions (CI/CD versioning)
// ---------------------------------------------------------------------------

export const agentVersions = pgTable('agent_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  version: integer('version').notNull(),
  config: jsonb('config').notNull(),
  changelog: text('changelog'),
  createdBy: uuid('created_by').references(() => users.id),
  status: text('status').notNull().default('draft'),
  testResults: jsonb('test_results'),
  promotedAt: timestamp('promoted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('idx_agent_versions_agent_version').on(table.agentId, table.version),
  index('idx_agent_versions_org').on(table.orgId),
  index('idx_agent_versions_agent_status').on(table.agentId, table.status),
])

// ---------------------------------------------------------------------------
// Agent Deployments (CI/CD deployment tracking)
// ---------------------------------------------------------------------------

export const agentDeployments = pgTable('agent_deployments', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'cascade' }).notNull(),
  versionId: uuid('version_id').references(() => agentVersions.id, { onDelete: 'cascade' }).notNull(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  environment: text('environment').notNull(),
  status: text('status').notNull().default('pending'),
  deployedBy: uuid('deployed_by').references(() => users.id),
  deployedAt: timestamp('deployed_at', { withTimezone: true }).defaultNow(),
  rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
  rollbackReason: text('rollback_reason'),
  metrics: jsonb('metrics').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_agent_deployments_agent_env').on(table.agentId, table.environment),
  index('idx_agent_deployments_org').on(table.orgId),
  index('idx_agent_deployments_status').on(table.status),
])

// ---------------------------------------------------------------------------
// Resellers (white-label partners)
// ---------------------------------------------------------------------------

export const resellers = pgTable('resellers', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  tier: text('tier').notNull().default('branded'),
  status: text('status').notNull().default('pending'),
  config: jsonb('config').notNull().default({}),
  wholesaleDiscount: real('wholesale_discount').notNull().default(0.4),
  maxSubOrgs: integer('max_sub_orgs').notNull().default(10),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('idx_resellers_org').on(table.orgId),
  index('idx_resellers_status').on(table.status),
])

// ---------------------------------------------------------------------------
// Sub-Organizations (tenants under a reseller)
// ---------------------------------------------------------------------------

export const subOrganizations = pgTable('sub_organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  resellerId: uuid('reseller_id').references(() => resellers.id, { onDelete: 'cascade' }).notNull(),
  parentOrgId: uuid('parent_org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  status: text('status').notNull().default('active'),
  plan: text('plan').notNull().default('free'),
  settings: jsonb('settings').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_sub_orgs_reseller').on(table.resellerId),
  index('idx_sub_orgs_parent').on(table.parentOrgId),
  uniqueIndex('idx_sub_orgs_org').on(table.orgId),
])

// ---------------------------------------------------------------------------
// Custom Domains
// ---------------------------------------------------------------------------

export const customDomains = pgTable('custom_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  resellerId: uuid('reseller_id').references(() => resellers.id, { onDelete: 'cascade' }).notNull(),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  domain: text('domain').unique().notNull(),
  type: text('type').notNull(),
  status: text('status').notNull().default('pending_verification'),
  dnsRecord: jsonb('dns_record').notNull().default({}),
  tlsCertificateId: text('tls_certificate_id'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_custom_domains_reseller').on(table.resellerId),
  index('idx_custom_domains_org').on(table.orgId),
])

// ---------------------------------------------------------------------------
// Agent Templates (syndicated by reseller)
// ---------------------------------------------------------------------------

export const agentTemplates = pgTable('agent_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  resellerId: uuid('reseller_id').references(() => resellers.id, { onDelete: 'cascade' }).notNull(),
  name: text('name').notNull(),
  description: text('description'),
  config: jsonb('config').notNull().default({}),
  isDefault: integer('is_default').notNull().default(0),
  targetSubOrgs: uuid('target_sub_orgs').array().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_agent_templates_reseller').on(table.resellerId),
])

// ---------------------------------------------------------------------------
// Impersonation Sessions
// ---------------------------------------------------------------------------

export const impersonationSessions = pgTable('impersonation_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  resellerId: uuid('reseller_id').references(() => resellers.id, { onDelete: 'cascade' }).notNull(),
  adminUserId: uuid('admin_user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  targetOrgId: uuid('target_org_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_impersonation_reseller').on(table.resellerId),
  index('idx_impersonation_admin').on(table.adminUserId),
  index('idx_impersonation_target').on(table.targetOrgId),
])

// ---------------------------------------------------------------------------
// Conversation Analytics
// ---------------------------------------------------------------------------

export const conversationAnalytics = pgTable('conversation_analytics', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').references(() => agentSessions.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),

  // Aggregates
  durationSeconds: integer('duration_seconds'),
  activeSpeakingSeconds: integer('active_speaking_seconds'),
  silenceSeconds: integer('silence_seconds'),
  participantCount: integer('participant_count'),
  totalTurns: integer('total_turns'),
  avgTurnLengthSeconds: real('avg_turn_length_seconds'),

  // Sentiment
  sentimentAvg: real('sentiment_avg'),
  sentimentMin: real('sentiment_min'),
  sentimentMax: real('sentiment_max'),
  sentimentTrend: text('sentiment_trend'), // 'improving' | 'declining' | 'stable' | 'volatile'

  // Topics
  topics: jsonb('topics').default([]),     // [{topic, duration_pct, sentiment_avg, key_phrases}]
  primaryTopic: text('primary_topic'),

  // Speakers
  speakers: jsonb('speakers').default([]), // [{id, name, talk_time_pct, turns, sentiment_avg, engagement_score}]

  // AI Insights
  summary: text('summary'),
  keyDecisions: text('key_decisions').array().default([]),
  actionItems: jsonb('action_items').default([]),
  recommendations: text('recommendations').array().default([]),
  highlights: jsonb('highlights').default([]),
  riskFlags: jsonb('risk_flags').default([]),

  processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_conversation_analytics_session').on(table.sessionId),
  index('idx_conversation_analytics_org').on(table.orgId, table.processedAt),
  index('idx_conversation_analytics_sentiment').on(table.orgId, table.sentimentAvg),
])

// ---------------------------------------------------------------------------
// Sentiment Timeseries (for charts)
// ---------------------------------------------------------------------------

export const sentimentTimeseries = pgTable('sentiment_timeseries', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').references(() => agentSessions.id, { onDelete: 'cascade' }).notNull(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  speaker: text('speaker').notNull(),
  sentiment: real('sentiment').notNull(),
  topic: text('topic'),
}, (table) => [
  index('idx_sentiment_ts_session').on(table.sessionId, table.timestamp),
  index('idx_sentiment_ts_speaker').on(table.sessionId, table.speaker),
])

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const conversationAnalyticsRelations = relations(conversationAnalytics, ({ one }) => ({
  session: one(agentSessions, {
    fields: [conversationAnalytics.sessionId],
    references: [agentSessions.id],
  }),
  organization: one(organizations, {
    fields: [conversationAnalytics.orgId],
    references: [organizations.id],
  }),
}))

export const sentimentTimeseriesRelations = relations(sentimentTimeseries, ({ one }) => ({
  session: one(agentSessions, {
    fields: [sentimentTimeseries.sessionId],
    references: [agentSessions.id],
  }),
}))

export const resellersRelations = relations(resellers, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [resellers.orgId],
    references: [organizations.id],
  }),
  subOrganizations: many(subOrganizations),
  customDomains: many(customDomains),
  agentTemplates: many(agentTemplates),
  impersonationSessions: many(impersonationSessions),
}))

export const subOrganizationsRelations = relations(subOrganizations, ({ one }) => ({
  reseller: one(resellers, {
    fields: [subOrganizations.resellerId],
    references: [resellers.id],
  }),
  parentOrg: one(organizations, {
    fields: [subOrganizations.parentOrgId],
    references: [organizations.id],
    relationName: 'parentOrg',
  }),
  organization: one(organizations, {
    fields: [subOrganizations.orgId],
    references: [organizations.id],
    relationName: 'subOrg',
  }),
}))

export const customDomainsRelations = relations(customDomains, ({ one }) => ({
  reseller: one(resellers, {
    fields: [customDomains.resellerId],
    references: [resellers.id],
  }),
  organization: one(organizations, {
    fields: [customDomains.orgId],
    references: [organizations.id],
  }),
}))

export const agentTemplatesRelations = relations(agentTemplates, ({ one }) => ({
  reseller: one(resellers, {
    fields: [agentTemplates.resellerId],
    references: [resellers.id],
  }),
}))

export const impersonationSessionsRelations = relations(impersonationSessions, ({ one }) => ({
  reseller: one(resellers, {
    fields: [impersonationSessions.resellerId],
    references: [resellers.id],
  }),
  adminUser: one(users, {
    fields: [impersonationSessions.adminUserId],
    references: [users.id],
    relationName: 'impersonator',
  }),
  targetOrg: one(organizations, {
    fields: [impersonationSessions.targetOrgId],
    references: [organizations.id],
  }),
  targetUser: one(users, {
    fields: [impersonationSessions.targetUserId],
    references: [users.id],
    relationName: 'impersonated',
  }),
}))

export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  apiKeys: many(apiKeys),
  agents: many(agents),
  sessions: many(agentSessions),
  conversations: many(conversations),
  usageRecords: many(usageRecords),
  auditLogs: many(auditLogs),
  webhooks: many(webhooks),
  orgMembers: many(orgMembers),
  customRoles: many(customRoles),
  invitations: many(invitations),
  teams: many(teams),
  samlConfig: many(samlConfigs),
  oidcConfig: many(oidcConfigs),
  userSessions: many(userSessions),
  marketplaceListings: many(marketplaceListings),
  marketplaceInstalls: many(marketplaceInstalls),
  publisherPayouts: many(publisherPayouts),
  resellers: many(resellers),
  customDomains: many(customDomains),
}))

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [users.orgId],
    references: [organizations.id],
  }),
  refreshTokens: many(refreshTokens),
  userSessions: many(userSessions),
  oauthAccounts: many(oauthAccounts),
  mfaSecret: many(mfaSecrets),
}))

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}))

export const userSessionsRelations = relations(userSessions, ({ one }) => ({
  user: one(users, {
    fields: [userSessions.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [userSessions.orgId],
    references: [organizations.id],
  }),
  refreshToken: one(refreshTokens, {
    fields: [userSessions.refreshTokenId],
    references: [refreshTokens.id],
  }),
}))

export const samlConfigsRelations = relations(samlConfigs, ({ one }) => ({
  organization: one(organizations, {
    fields: [samlConfigs.orgId],
    references: [organizations.id],
  }),
}))

export const oidcConfigsRelations = relations(oidcConfigs, ({ one }) => ({
  organization: one(organizations, {
    fields: [oidcConfigs.orgId],
    references: [organizations.id],
  }),
}))

export const mfaSecretsRelations = relations(mfaSecrets, ({ one }) => ({
  user: one(users, {
    fields: [mfaSecrets.userId],
    references: [users.id],
  }),
}))

export const oauthAccountsRelations = relations(oauthAccounts, ({ one }) => ({
  user: one(users, {
    fields: [oauthAccounts.userId],
    references: [users.id],
  }),
}))

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  organization: one(organizations, {
    fields: [apiKeys.orgId],
    references: [organizations.id],
  }),
}))

export const agentsRelations = relations(agents, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [agents.orgId],
    references: [organizations.id],
  }),
  sessions: many(agentSessions),
  versions: many(agentVersions),
  deployments: many(agentDeployments),
}))

export const agentVersionsRelations = relations(agentVersions, ({ one, many }) => ({
  agent: one(agents, {
    fields: [agentVersions.agentId],
    references: [agents.id],
  }),
  organization: one(organizations, {
    fields: [agentVersions.orgId],
    references: [organizations.id],
  }),
  createdByUser: one(users, {
    fields: [agentVersions.createdBy],
    references: [users.id],
  }),
  deployments: many(agentDeployments),
}))

export const agentDeploymentsRelations = relations(agentDeployments, ({ one }) => ({
  agent: one(agents, {
    fields: [agentDeployments.agentId],
    references: [agents.id],
  }),
  version: one(agentVersions, {
    fields: [agentDeployments.versionId],
    references: [agentVersions.id],
  }),
  organization: one(organizations, {
    fields: [agentDeployments.orgId],
    references: [organizations.id],
  }),
  deployedByUser: one(users, {
    fields: [agentDeployments.deployedBy],
    references: [users.id],
  }),
}))

export const agentSessionsRelations = relations(agentSessions, ({ one, many }) => ({
  agent: one(agents, {
    fields: [agentSessions.agentId],
    references: [agents.id],
  }),
  organization: one(organizations, {
    fields: [agentSessions.orgId],
    references: [organizations.id],
  }),
  conversations: many(conversations),
  usageRecords: many(usageRecords),
}))

export const conversationsRelations = relations(conversations, ({ one }) => ({
  session: one(agentSessions, {
    fields: [conversations.sessionId],
    references: [agentSessions.id],
  }),
  organization: one(organizations, {
    fields: [conversations.orgId],
    references: [organizations.id],
  }),
}))

export const usageRecordsRelations = relations(usageRecords, ({ one }) => ({
  organization: one(organizations, {
    fields: [usageRecords.orgId],
    references: [organizations.id],
  }),
  session: one(agentSessions, {
    fields: [usageRecords.sessionId],
    references: [agentSessions.id],
  }),
}))

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  organization: one(organizations, {
    fields: [auditLogs.orgId],
    references: [organizations.id],
  }),
  actor: one(users, {
    fields: [auditLogs.actorId],
    references: [users.id],
  }),
}))

export const orgMembersRelations = relations(orgMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [orgMembers.orgId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [orgMembers.userId],
    references: [users.id],
    relationName: 'membership',
  }),
  customRole: one(customRoles, {
    fields: [orgMembers.customRoleId],
    references: [customRoles.id],
  }),
  inviter: one(users, {
    fields: [orgMembers.invitedBy],
    references: [users.id],
    relationName: 'inviter',
  }),
}))

export const customRolesRelations = relations(customRoles, ({ one }) => ({
  organization: one(organizations, {
    fields: [customRoles.orgId],
    references: [organizations.id],
  }),
}))

export const invitationsRelations = relations(invitations, ({ one }) => ({
  organization: one(organizations, {
    fields: [invitations.orgId],
    references: [organizations.id],
  }),
  inviter: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id],
  }),
}))

export const teamsRelations = relations(teams, ({ one }) => ({
  organization: one(organizations, {
    fields: [teams.orgId],
    references: [organizations.id],
  }),
}))

export const webhooksRelations = relations(webhooks, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [webhooks.orgId],
    references: [organizations.id],
  }),
  deliveries: many(webhookDeliveries),
}))

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  webhook: one(webhooks, {
    fields: [webhookDeliveries.webhookId],
    references: [webhooks.id],
  }),
}))

export const marketplaceListingsRelations = relations(marketplaceListings, ({ one, many }) => ({
  publisher: one(users, {
    fields: [marketplaceListings.publisherId],
    references: [users.id],
  }),
  publisherOrg: one(organizations, {
    fields: [marketplaceListings.publisherOrgId],
    references: [organizations.id],
  }),
  installs: many(marketplaceInstalls),
  reviews: many(marketplaceReviews),
}))

export const marketplaceInstallsRelations = relations(marketplaceInstalls, ({ one }) => ({
  listing: one(marketplaceListings, {
    fields: [marketplaceInstalls.listingId],
    references: [marketplaceListings.id],
  }),
  organization: one(organizations, {
    fields: [marketplaceInstalls.orgId],
    references: [organizations.id],
  }),
  installedByUser: one(users, {
    fields: [marketplaceInstalls.installedBy],
    references: [users.id],
  }),
}))

export const marketplaceReviewsRelations = relations(marketplaceReviews, ({ one }) => ({
  listing: one(marketplaceListings, {
    fields: [marketplaceReviews.listingId],
    references: [marketplaceListings.id],
  }),
  user: one(users, {
    fields: [marketplaceReviews.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [marketplaceReviews.orgId],
    references: [organizations.id],
  }),
}))

export const publisherPayoutsRelations = relations(publisherPayouts, ({ one }) => ({
  publisherOrg: one(organizations, {
    fields: [publisherPayouts.publisherOrgId],
    references: [organizations.id],
  }),
}))


