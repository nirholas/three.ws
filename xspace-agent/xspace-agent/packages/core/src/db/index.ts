// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Database — Main exports
// =============================================================================

// Connection management
export {
  initDatabase,
  getDatabase,
  getPool,
  getClient,
  checkDatabaseHealth,
  closeDatabase,
  type DatabaseConfig,
} from './connection'

// Redis
export {
  initRedis,
  getRedis,
  checkRedisHealth,
  closeRedis,
  setJSON,
  getJSON,
  checkRateLimit as checkRedisRateLimit,
  type RedisConfig,
} from './redis'

// Schema (for direct Drizzle queries)
export * as dbSchema from './schema'

// Repositories
export {
  OrganizationRepository,
  UserRepository,
  AgentRepository,
  SessionRepository,
  ConversationRepository,
  UsageRepository,
  AuditRepository,
  ApiKeyRepository,
  WebhookRepository,
  WebhookDeliveryRepository,
  MemberRepository,
  CustomRoleRepository,
  InvitationRepository,
  TeamRepository,
  MarketplaceListingRepository,
  MarketplaceInstallRepository,
  MarketplaceReviewRepository,
  PublisherPayoutRepository,
  AnalyticsRepository,
  AgentVersionRepository,
  AgentDeploymentRepository,
} from './repositories'

export type {
  Organization,
  NewOrganization,
  User,
  NewUser,
  Agent,
  NewAgent,
  AgentSession,
  NewAgentSession,
  Conversation,
  NewConversation,
  UsageRecord,
  NewUsageRecord,
  UsageAggregate,
  AuditLog,
  NewAuditLog,
  ApiKey,
  NewApiKey,
  Webhook,
  NewWebhook,
  WebhookDelivery,
  NewWebhookDelivery,
  OrgMemberRow,
  NewOrgMember,
  CustomRoleRow,
  NewCustomRole,
  InvitationRow,
  NewInvitation,
  TeamRow,
  NewTeam,
  MarketplaceListing,
  NewMarketplaceListing,
  ListingSearchOptions,
  MarketplaceInstall,
  NewMarketplaceInstall,
  MarketplaceReview,
  NewMarketplaceReview,
  PublisherPayout,
  NewPublisherPayout,
  ConversationAnalyticsRow,
  NewConversationAnalytics,
  SentimentTimeseriesRow,
  NewSentimentTimeseries,
  AgentVersion,
  NewAgentVersion,
  VersionStatus,
  AgentDeployment,
  NewAgentDeployment,
  DeploymentEnvironment,
  DeploymentStatus,
} from './repositories'


