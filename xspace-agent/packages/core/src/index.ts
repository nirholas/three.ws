// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// xspace-agent — Main exports
// =============================================================================

// Core classes
export { XSpaceAgent } from './agent'
export { AgentTeam } from './team'

// Error classes
export {
  XSpaceError,
  AuthenticationError,
  SpaceNotFoundError,
  SpaceEndedError,
  BrowserConnectionError,
  SpeakerAccessDeniedError,
  ProviderError,
  ConfigValidationError,
  SelectorBrokenError,
} from './errors'

// Config validation
export { validateConfig, AgentConfigSchema } from './config'
export type { ValidatedAgentConfig } from './config'

// Types
export type {
  AgentConfig,
  AuthConfig,
  AIConfig,
  VoiceConfig,
  BrowserConfig,
  BehaviorConfig,
  AgentStatus,
  Message,
  MessageMetadata,
  Sentiment,
  TranscriptionEvent,
  ResponseEvent,
  SpeakerEvent,
  CustomProvider,
  LLMProvider,
  STTProvider,
  TTSProvider,
  MiddlewareStage,
  AgentTeamConfig,
  TeamAgentConfig,
  TurnManagementConfig,
  AgentEvents,
  TeamAgentSelectedEvent,
  TeamHandoffEvent,
  TeamInterruptionEvent,
  TeamTurnCompleteEvent,
  TeamEvents,
} from './types'

// Team snapshot types
export type { TeamAgentSnapshot, TeamSnapshot } from './team'

// Provider factories (for advanced usage)
export { createLLM } from './pipeline/llm'
export { createSTT } from './pipeline/stt'
export { createTTS, createTTSWithFallback } from './pipeline/tts'
export type { STTConfig } from './pipeline/stt'
export type { TTSConfig } from './pipeline/tts'

// Provider intelligence (routing, cost tracking, health monitoring)
export { ProviderRouter } from './providers/router'
export { CostTracker } from './providers/cost-tracker'
export { ProviderHealthMonitor } from './providers/health-monitor'
export type {
  RoutableProvider,
  RoutingStrategy,
  RoutingPriority,
  RouterConfig,
  ProviderStatus,
  HealthCheckResult,
  CostEntry,
  CostSummary,
} from './providers/types'
export type { HealthEvent, HealthEventHandler } from './providers/health-monitor'

// Billing & usage metering
export { UsageTracker, getQuotaLimit } from './billing/usage-tracker'
export type { UsageTrackerConfig } from './billing/usage-tracker'
export type { UsageMetric, QuotaResult, UsageSummary, UsageBreakdown, AlertThreshold } from './billing/types'
export { DEFAULT_ALERT_THRESHOLDS, RATE_LIMITS_BY_PLAN, ENDPOINT_GROUP_LIMITS } from './billing/types'

// Audio utilities (for advanced usage)
export { pcmChunksToWav, mp3ToPcmFloat32 } from './audio/bridge'
export { VoiceActivityDetector } from './audio/vad'

// Extracted sub-modules (for advanced composition)
export { BrowserLifecycle } from './browser/lifecycle'
export { AudioPipeline } from './audio/pipeline'
export type { AudioPipelineConfig } from './audio/pipeline'
export { ConversationManager } from './conversation'
export type { ConversationConfig } from './conversation'
export { HealthMonitor } from './health'

// Self-healing selector engine + CDP observer
export { SelectorEngine, validateSelectors } from './browser/selector-engine'
export type {
  SelectorDefinition,
  SelectorStrategy,
  SelectorHealthReport,
  SelectorFailureEntry,
} from './browser/selector-engine'
export { DOMObserver } from './browser/observer'
export type { DOMObserverEvents } from './browser/observer'
export { SELECTOR_DEFINITIONS } from './browser/selectors'

// Intelligence layer
export { detectSentiment } from './intelligence/sentiment'
export { SpeakerIdentifier } from './intelligence/speaker-id'
export type { SpeakerProfile } from './intelligence/speaker-id'
export { TopicTracker } from './intelligence/topic-tracker'
export type { TopicEntry } from './intelligence/topic-tracker'
export { ContextManager } from './intelligence/context-manager'
export type { ContextManagerConfig } from './intelligence/context-manager'
export { PromptBuilder } from './intelligence/prompt-builder'
export { ConversationStore } from './intelligence/persistence'
export type { ConversationRecord, SpaceMetadata } from './intelligence/persistence'

// Logger (legacy interface)
export { getLogger, setLogger, redactSecrets } from './logger'
export type { Logger } from './logger'

// Secure cookie store
export { SecureCookieStore } from './browser/secure-cookie-store'

// Observability (structured logging, metrics, transports)
export {
  createLogger,
  childLogger,
  getAppLogger,
  setAppLogger,
  type LoggerConfig,
  MetricsCollector,
  getMetrics,
  startProcessMetrics,
  stopProcessMetrics,
  SocketLogTransport,
  createStreamingLogger,
} from './observability'

// Plugin system
export { PluginManager } from './plugins/manager'
export type { Plugin, PluginContext, AudioFrame, SpeakerInfo } from './plugins/types'

// Turn management
export {
  DecisionEngine,
  InterruptionHandler,
  AdaptiveSilenceDetector,
  ResponsePacer,
  TurnCoordinator,
} from './turns'
export type {
  DecisionEngineConfig,
  InterruptionConfig,
  AdaptiveSilenceConfig,
  PacingConfig,
  CoordinatorConfig,
} from './turns'
export type {
  ResponseDecision,
  InterruptionAction,
  ConversationPace,
  Responsiveness,
  DecisionInput,
  ConversationSignals,
  TurnDecisionEvent,
  TurnInterruptedEvent,
} from './types'

// Database layer
export {
  initDatabase,
  getDatabase,
  getPool,
  getClient,
  checkDatabaseHealth,
  closeDatabase,
  initRedis,
  getRedis,
  checkRedisHealth,
  closeRedis,
  setJSON,
  getJSON,
  checkRedisRateLimit,
  dbSchema,
  OrganizationRepository,
  UserRepository,
  AgentRepository,
  SessionRepository,
  ConversationRepository as ConversationDBRepository,
  UsageRepository,
  AuditRepository,
  ApiKeyRepository,
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
} from './db'
export type {
  DatabaseConfig,
  RedisConfig,
  Organization,
  NewOrganization,
  User,
  NewUser,
  Agent as DbAgent,
  NewAgent,
  AgentSession,
  NewAgentSession,
  Conversation as DbConversation,
  NewConversation,
  UsageRecord,
  NewUsageRecord,
  UsageAggregate,
  AuditLog,
  NewAuditLog,
  ApiKey,
  NewApiKey,
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
  AgentDeployment,
  NewAgentDeployment,
} from './db'

// Conversation Intelligence Analytics
export {
  scoreSentiment,
  computeSentimentTrend,
  analyzeTopics,
  analyzeSpeakers,
  computeConversationMetrics,
  detectHighlights,
  detectRiskFlags,
  runAnalyticsPipeline,
  extractActionItems,
  extractKeyDecisions,
  generateRuleBasedSummary,
  generateRecommendations,
  generateInsights,
  RealtimeAnalyticsProcessor,
} from './analytics'
export type {
  AnalyticsPipelineResult,
  SentimentScore,
  SentimentPoint,
  SentimentTrend,
  TopicBreakdown,
  SpeakerAnalytics,
  ConversationMetrics,
  ActionItem,
  Highlight,
  RiskFlag,
  SessionInsights,
  TranscriptionMessage as AnalyticsMessage,
  AnalyticsPipelineInput,
  LiveAnalyticsState,
  AnalyticsSentimentEvent,
  AnalyticsTopicEvent,
  AnalyticsAlertEvent,
  AnalyticsEvent,
} from './analytics'

// Multi-tenant system
export {
  PLANS,
  getPlan,
  getDefaultQuotas,
  createFeatureFlags,
  runWithTenant,
  getTenantContext,
  getTenantContextOrNull,
  getCurrentOrgId,
  createOrganization,
  deleteOrganization,
  suspendOrganization,
  reactivateOrganization,
  changePlan,
  getOrganization as getTenantOrganization,
  getOrganizationBySlug,
  resolveApiKey as resolveTenantApiKey,
  getOrgMembers,
  getOrgQuotas,
  getOrgApiKeys,
  getTenantEvents,
  addMember,
  removeMember,
  QuotaEnforcer,
  TenantRepository,
} from './tenant'
export type {
  OrgId,
  UserId,
  PlanTier,
  Plan,
  Quotas,
  FeatureFlags,
  OrgStatus,
  SuspensionReason,
  Organization as TenantOrganization,
  OrgRole,
  OrgMember,
  CustomRole,
  Invitation,
  InvitationStatus,
  Team,
  ApiKey as TenantApiKey,
  TenantContext,
  TenantEvent,
  FeatureName,
  CreateOrganizationInput,
  CreateOrganizationResult,
  AddMemberInput,
} from './tenant'

// RBAC — Role-based access control
export {
  PERMISSION_SCOPES,
  ROLES,
  resolvePermissions,
  roleHasPermission,
  roleHasAllPermissions,
  isRoleAtLeast,
  hasPermission,
  isValidPermission,
  validatePermissions,
} from './rbac'
export type {
  Permission,
  BuiltInRole,
  RoleDefinition,
} from './rbac'

// Data isolation verification
export { runIsolationChecks } from './db/isolation-check'
export type { IsolationCheckResult, IsolationReport } from './db/isolation-check'

// API Gateway
export {
  API_SCOPES,
  API_VERSIONS,
  ApiKeyService,
  ApiError,
  createAuthMiddleware,
  requireScope,
  createRateLimitMiddleware,
  createVersioningMiddleware,
  createRequestLoggerMiddleware,
  createErrorHandlerMiddleware,
  onRequestLog,
  offRequestLog,
  clearRequestLogHandlers,
  createApiKey as createApiKeyHandler,
  listApiKeys,
  getApiKey as getApiKeyHandler,
  updateApiKey as updateApiKeyHandler,
  deleteApiKey as deleteApiKeyHandler,
  rotateApiKey,
  getApiStatus,
} from './gateway'
export type {
  ApiScope,
  ApiKeyEnvironment,
  ParsedApiKey,
  ApiVersion,
  VersionStatus,
  VersionInfo,
  ApiErrorType,
  ApiErrorBody,
  ApiRequestLog,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  UpdateApiKeyRequest,
  ApiKeyInfo,
  RotateApiKeyResponse,
  AuthenticatedRequest,
  GatewayConfig,
  RequestLogHandler,
} from './gateway'

// Audit logging & compliance
export {
  AUDIT_EVENTS,
  AuditService,
  ComplianceService,
  InMemoryComplianceStore,
  RetentionEnforcer,
  computeEntryHash,
  verifyEntryHash,
  verifyChain,
} from './audit'
export type {
  AuditAction,
  ActorType,
  AuditSeverity,
  RetentionDuration,
  AuditEventMeta,
  AuditEventInput,
  AuditLogEntry,
  AuditFilters,
  PaginatedAuditLogs,
  IntegrityReport,
  AuditSummary,
  GeoLocation,
  DataExportResult,
  DataDeletionResult,
  SecurityAlert,
  SecurityAlertHandler,
  AlertChannel,
  RetentionArchiveResult,
  AuditServiceConfig,
  AuditStore,
  ComplianceDataStore,
  ArchiveHandler,
} from './audit'

// Enterprise Authentication (SSO/SAML/OIDC)
export {
  // Auth service
  register as authRegister,
  login as authLogin,
  logout as authLogout,
  logoutAll as authLogoutAll,
  refreshTokens as authRefreshTokens,
  createPasswordResetToken,
  resetPassword,
  // Token management
  signAccessToken,
  verifyAccessToken,
  createTokenPair,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  // Password
  hashPassword,
  verifyPassword as verifyPasswordHash,
  validatePassword,
  requireStrongPassword,
  getLockoutDuration,
  isAccountLocked,
  // MFA
  setupMFA,
  verifyMFASetup,
  verifyMFACode,
  disableMFA,
  isMFAEnabled,
  // Sessions
  createSession as createAuthSession,
  listSessions as listAuthSessions,
  revokeSession as revokeAuthSession,
  revokeAllSessions as revokeAllAuthSessions,
  touchSession,
  cleanupExpiredSessions,
  // SAML
  getSAMLConfig,
  getSAMLConfigBySlug,
  upsertSAMLConfig,
  generateSPMetadata,
  extractSAMLProfile,
  provisionSAMLUser,
  isSSOEnforced,
  // OIDC
  getOIDCConfig,
  getOIDCConfigBySlug,
  upsertOIDCConfig,
  getOIDCAuthorizationUrl,
  handleOIDCCallback,
  provisionOIDCUser,
  // OAuth
  findOrCreateOAuthUser,
  linkOAuthAccount,
  getLinkedAccounts,
  unlinkOAuthAccount,
  getOAuthConfig,
  // Middleware
  authMiddleware,
  rateLimitMiddleware as authRateLimitMiddleware,
  requireScopes,
  requireRole,
  resolveAuthContext,
  extractBearerToken,
  verifyToken,
  // Crypto
  encrypt as encryptSecret,
  decrypt as decryptSecret,
  generateSecureToken,
  sha256 as hashSHA256,
  // Errors
  InvalidCredentialsError,
  AccountLockedError,
  EmailAlreadyExistsError,
  TokenError,
  MFARequiredError,
  MFAVerificationError,
  SSOEnforcedError,
  SAMLError,
  OIDCError,
  SessionLimitError,
  WeakPasswordError,
  // Constants
  SESSION_LIMITS,
  LOCKOUT_POLICY,
} from './auth'
export type {
  AccessTokenPayload,
  RefreshTokenRecord,
  TokenPair,
  UserSession,
  SAMLConfig,
  SAMLProfile,
  OIDCConfig,
  OIDCProfile,
  OAuthProvider,
  OAuthProfile,
  OAuthAccount,
  MFASetupResult,
  MFASecretRecord,
  AuthEventType,
  AuthEvent,
  AuthRequestContext,
  RegisterInput,
  LoginInput,
  AuthResult,
  PasswordValidation,
  AuthenticatedUser,
  OAuthProviderConfig,
} from './auth'

// Event streaming
export {
  EventPublisher,
  EventSubscriber,
  EventBuffer,
  ConnectionManager,
  matchGlob,
  matchesFilter,
  DEFAULT_CONNECTION_LIMITS,
} from './events'
export type {
  StreamEvent,
  TranscriptionChunkEvent,
  ResponseThinkingEvent,
  ResponseGeneratedEvent,
  ResponseSpokenEvent,
  SessionMetricsEvent,
  AgentStateChangeEvent,
  AgentErrorEvent,
  TeamTurnChangeEvent,
  TeamHandoffEvent as EventsTeamHandoffEvent,
  UsageThresholdEvent,
  SystemAnnouncementEvent,
  EventEnvelope,
  EventFilter,
  ConnectionLimits,
  Subscription,
} from './events'

// Onboarding & PLG (self-serve funnel, templates, activation, referrals, analytics)
export {
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
  // Agent templates
  AGENT_TEMPLATES,
  getTemplate,
  getTemplatesByCategory,
  getTemplatesForPlan,
  getFeaturedTemplates,
  // Activation tracking
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
  recordDripEmailOpened,
  evaluateDueEmails,
  // Referral program
  REFERRAL_CREDIT_CENTS,
  REFERRAL_EXPIRY_DAYS,
  getOrCreateReferralCode,
  createReferral,
  getReferralByCode,
  getReferral,
  markReferralSignedUp,
  markReferralConverted,
  applyReferralCredit,
  getUserReferrals,
  getReferralSummary,
  expireOldReferrals,
  clearReferrals,
  // Product analytics
  registerAnalyticsHandler,
  clearAnalyticsHandlers,
  trackEvent,
  trackOnboardingStep,
  trackSignup,
  trackAgentCreated,
  trackSessionStarted,
  trackUpgrade,
  trackUpgradePromptShown,
  trackUpgradePromptDismissed,
  trackReferralShared,
  trackReferralConverted,
  getRecentEvents,
  getFunnelMetrics,
  clearEventBuffer,
} from './onboarding'
export type {
  UseCase,
  TargetPlatform,
  PersonalityArchetype,
  OnboardingStep,
  WizardAnswers,
  QuickAgentInput,
  OnboardingState,
  AgentTemplate,
  ActivationEvent,
  ActivationRecord,
  ActivationSummary,
  UpgradePromptLocation,
  UpgradeTrigger,
  UpgradePrompt,
  DripEmailId,
  DripEmail,
  DripCondition,
  DripCampaignState,
  ReferralStatus,
  Referral,
  ReferralSummary,
  AnalyticsCategory,
  AnalyticsEvent as OnboardingAnalyticsEvent,
  AnalyticsHandler,
} from './onboarding'

// Memory & RAG
export {
  MemoryStore,
  KnowledgeBase,
  MemoryExtractor,
  ContextRetriever,
  EmbeddingClient,
  cosineSimilarity,
  searchBySimilarity,
} from './memory'
export type {
  Memory,
  MemoryType,
  UserProfile,
  MemoryConfig,
  KnowledgeConfig,
  DocumentChunk,
  IndexedDocument,
  RetrievalResult,
} from './memory'

// Real-Time Translation (50+ languages)
export {
  TranslationService,
  LanguageDetector,
  createTranslationProvider,
  createDeepLProvider,
  createGoogleProvider,
  createOpenAITranslationProvider,
  createTranslationMiddleware,
  SUPPORTED_LANGUAGES,
  getLanguage,
  getLanguagesByTier,
  getSupportedLanguageCodes,
  isLanguageSupported,
} from './translation'
export type {
  TranslationConfig,
  TranslationResult,
  TranslateOptions,
  TranslationProvider as TranslationProviderInterface,
  LanguageDetection,
  Language,
  LanguageTier,
  LanguagePair,
  GlossaryEntry,
  Glossary,
  TranslationMetrics,
  TranslationMiddleware,
} from './translation'

// White-Label & Reseller Program
export {
  ResellerService,
  CustomDomainService,
  ImpersonationService,
  WHITE_LABEL_PRICING,
  WHITE_LABEL_FEATURES,
  WHOLESALE_DISCOUNT_TIERS,
  getWholesaleDiscount,
} from './reseller'
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
  AgentTemplate as ResellerAgentTemplate,
  CreateAgentTemplateInput,
  ImpersonationSession,
  StartImpersonationInput,
  WholesaleDiscountTier,
  ResellerBillingSummary,
  ResellerAnalytics,
} from './reseller'

// Reseller repositories
export {
  ResellerRepository,
  SubOrganizationRepository,
  CustomDomainRepository,
  AgentTemplateRepository,
  ImpersonationSessionRepository,
} from './db/repositories'
export type {
  ResellerRow,
  NewReseller,
  SubOrganizationRow,
  NewSubOrganization,
  CustomDomainRow,
  NewCustomDomain,
  AgentTemplateRow,
  NewAgentTemplate,
  ImpersonationSessionRow,
  NewImpersonationSession,
} from './db/repositories'

// Agent CI/CD & Versioning
export { CICDService, AgentTestRunner } from './cicd'
export type {
  CICDServiceConfig,
  TestRunnerProvider,
  VersionStatus as CICDVersionStatus,
  DeploymentEnvironment as CICDDeploymentEnvironment,
  DeploymentStatus as CICDDeploymentStatus,
  AgentTest,
  AgentTestResult,
  TestSuiteResult,
  PromotionRequest,
  RollbackRequest,
  CanaryConfig,
  DeploymentMetrics,
  CreateVersionInput,
  DeployVersionInput,
} from './cicd'

// FSM engine & machines
export { StateMachine } from './fsm/machine'
export type { MachineConfig, StateDefinition, TransitionDefinition, TransitionRecord } from './fsm/machine'
export { createAgentMachine, AGENT_STATES } from './fsm/agent-machine'
export type { AgentEvent, AgentContext, AgentState } from './fsm/agent-machine'
export { createTeamMachine, TEAM_STATES } from './fsm/team-machine'
export type { TeamEvent, TeamContext, TeamState } from './fsm/team-machine'

// No-code agent builder
export {
  transpileFlowToConfig,
  validateFlow,
  FLOW_TEMPLATES,
  getFlowTemplates,
  getFlowTemplate,
  getFlowTemplatesByCategory,
} from './builder'
export type {
  FlowNodeType,
  TriggerKind,
  ListenerKind,
  ProcessorKind,
  ResponderKind,
  ModifierKind,
  NodeKind,
  FlowNodePosition,
  FlowConnection,
  FlowNode,
  PersonalityConfig,
  FlowVariable,
  AgentFlow,
  DeployPlatform,
  DeployMode,
  DeployConfig,
  DeployedAgent,
  FlowTemplate,
  TestMessage,
  TestSession,
  ValidationError,
  ValidationResult,
} from './builder'


