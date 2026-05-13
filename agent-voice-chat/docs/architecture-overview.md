# Architecture Overview

## What This Project Is

**xspace-agent** is a TypeScript SDK and enterprise platform for building AI voice agents that autonomously join, listen, and speak in X (Twitter) Spaces. It started as a monolithic Node.js app ("Swarmsy"), was refactored into a modular monorepo SDK, and has since grown into a full multi-tenant SaaS platform with enterprise auth, billing, marketplace, and white-label reseller support.

For quick-start commands, SDK internals, and contributor patterns, see [CLAUDE.md](../CLAUDE.md).
For the core SDK module map and key interfaces, see [packages/core/CLAUDE.md](../packages/core/CLAUDE.md).

---

## Monorepo Package Map

| Package | npm Name | Purpose |
|---------|----------|---------|
| `packages/core/` | `xspace-agent` | Main SDK. Agent class, audio pipeline, browser automation, LLM/STT/TTS providers, intelligence, turn management, FSM, plugins — plus enterprise modules (auth, tenancy, billing, etc.) |
| `packages/server/` | `@xspace/server` | Express + Socket.IO admin panel with auth, rate limiting, real-time agent control, 11 route files |
| `packages/cli/` | `@xspace/cli` | CLI tool: `xspace-agent init\|auth\|join\|start\|dashboard` |
| `packages/widget/` | — | UI widget components (early stage) |
| `packages/create-xspace-agent/` | `create-xspace-agent` | Project scaffolding template |

**Other directories:**

| Directory | Purpose |
|-----------|---------|
| `src/` | Legacy monolithic server. Still functional via `npm run dev`. Being migrated into `packages/`. |
| `agent-voice-chat/` | Standalone voice chat agent with own test suite, OpenAPI spec, memory system |
| `x-spaces/` | Legacy Puppeteer automation scripts (JavaScript) |
| `xspace-agent/` | Separate reference/production implementation with its own package.json |
| `examples/` | 12 runnable example projects |
| `public/` | Frontend HTML/CSS/JS for dashboard and agent UIs |
| `providers/` | Legacy JS provider implementations (predates packages/core) |
| `personalities/` | 5 JSON personality presets (comedian, crypto-degen, educator, interviewer, tech-analyst) |
| `docs/` | 34 markdown docs covering architecture, deployment, API reference, and more |
| `docker/` | Prometheus + Grafana configs for monitoring profile |

---

## System Architecture

The system is organized in three tiers:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        TIER 3 — Application Layer                          │
│                                                                             │
│  Server (11 routes)  │  CLI (5 commands)  │  Widget  │  Admin Dashboard    │
│  analytics, builder, │  init, auth, join, │          │  (public/)          │
│  deployments, events,│  start, dashboard  │          │                     │
│  marketplace, onboard│                    │          │                     │
│  org, personalities, │                    │          │                     │
│  reseller, usage,    │                    │          │                     │
│  voices              │                    │          │                     │
└──────────────────────┴────────────────────┴──────────┴─────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────────┐
│                      TIER 2 — Platform Services                            │
│                                                                             │
│  auth/     │ tenant/  │ gateway/ │ billing/  │ queue/       │ events/      │
│  SAML,OIDC │ orgs,    │ API keys │ usage     │ 7 job        │ pub/sub      │
│  OAuth,MFA │ plans,   │ versions │ metering  │ processors   │ streaming    │
│  sessions  │ quotas,  │ rate     │ overage   │              │              │
│            │ features │ limiting │           │              │              │
│────────────┼──────────┼──────────┼───────────┼──────────────┼──────────────│
│  rbac/     │ audit/   │ db/      │ webhooks/ │ observability│ onboarding/  │
│  roles,    │ hash-    │ Postgres │ delivery, │ Pino logs,   │ wizard,drip  │
│  perms     │ chain,   │ + Redis  │ signing,  │ metrics,     │ referrals,   │
│            │ GDPR     │ 26 repos │ retries   │ transports   │ upgrade      │
└────────────┴──────────┴──────────┴───────────┴──────────────┴──────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TIER 1 — SDK Core                                  │
│                                                                             │
│  XSpaceAgent  │  AgentTeam  │  StateMachine  │  PluginManager              │
│               │             │                │                              │
│  audio/       │ browser/    │ pipeline/      │ intelligence/  │ turns/      │
│  capture,VAD, │ lifecycle,  │ LLM,STT,TTS   │ sentiment,     │ decision,   │
│  echo,gain,   │ selectors,  │ factories,     │ speaker-id,    │ interrupts, │
│  WebRTC       │ observer,   │ cache          │ topics,context │ pacing,     │
│               │ auth,cookies│                │ prompts,store  │ coordinator │
│───────────────┼─────────────┼────────────────┼────────────────┼─────────────│
│  providers/   │ fsm/        │ plugins/       │ middleware/    │             │
│  router,cost, │ agent,team  │ manager,types  │ 6 stages       │             │
│  health       │ machines    │                │                │             │
│───────────────┴─────────────┴────────────────┴────────────────┘             │
│                                                                             │
│  Specialized: memory/ │ translation/ │ voice/ │ analytics/ │ builder/      │
│               (RAG)   │ (50+ langs)  │(clone) │ (realtime) │ (no-code)    │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Data flow**: HTTP/WS requests enter through the Gateway (Tier 2), pass through auth → RBAC → tenant middleware, reach route handlers (Tier 3), which orchestrate platform services (Tier 2) and the SDK core (Tier 1).

---

## Tier 1 — SDK Core

The SDK core handles the real-time voice agent loop: browser automation, audio capture, speech-to-text, LLM reasoning, text-to-speech, and audio injection back into X Spaces.

This layer is thoroughly documented in:
- [CLAUDE.md](../CLAUDE.md) — Architecture diagram, key classes table, data flow walkthrough, provider pattern, state machine, middleware pipeline
- [packages/core/CLAUDE.md](../packages/core/CLAUDE.md) — Complete module map, key interfaces, testing guide, contribution patterns

### Key classes (summary)

| Class | Purpose |
|-------|---------|
| `XSpaceAgent` | Main entry point. Orchestrates browser, audio, LLM, and turn management |
| `AgentTeam` | Multi-agent coordination on a shared browser session |
| `BrowserLifecycle` | Puppeteer launch, login, Space join/leave lifecycle |
| `AudioPipeline` | Audio capture → VAD → silence detection → WAV encoding |
| `SelectorEngine` | Self-healing CSS selectors (CSS → text → aria fallback) |
| `ProviderRouter` | Intelligent LLM routing across providers |
| `DecisionEngine` | Should-I-respond logic based on conversation signals |
| `StateMachine` | Generic FSM engine for agent and team lifecycles |

### Voice pipeline

```
X Space audio → Puppeteer/CDP → PCM capture → VAD → Whisper STT
→ Intelligence (speaker ID, topics, sentiment, context)
→ Decision Engine → LLM → TTS → Audio injection back into Space
```

---

## Tier 2 — Enterprise Platform Services

These modules provide the infrastructure for running xspace-agent as a multi-tenant SaaS platform.

### Multi-Tenancy (`tenant/`)

Organizations with hierarchical structure and plan-based resource control.

- **5 plan tiers**: free ($0), developer ($49/mo), pro ($299/mo), business ($1,999/mo), enterprise (custom)
- **Quotas per plan**: max agents, concurrent sessions, session minutes/month, API calls/minute
- **Feature flags**: Per-plan feature gating (e.g., `multi-agent`, `webhooks`, `white-label`)
- **Organization lifecycle**: Create, suspend (for non-payment, abuse, or manual), reactivate, delete
- **Tenant isolation**: `runWithTenant()` async context propagation, enforced at the repository layer

Key exports: `PLANS`, `QuotaEnforcer`, `createOrganization`, `changePlan`, `runWithTenant`

### Authentication & Authorization (`auth/`, `rbac/`)

Enterprise-grade authentication with SSO and fine-grained access control.

**Authentication (`auth/`):**
- JWT access tokens + refresh token rotation with replay detection
- SAML 2.0 federation (SP metadata generation, profile extraction, user provisioning)
- OpenID Connect (authorization URL generation, callback handling, user provisioning)
- OAuth providers: Google, GitHub, Microsoft
- MFA: TOTP setup (QR code generation), verification, recovery codes
- Session management: per-user limits (default 5), device tracking, expiry cleanup
- Account security: progressive lockout (15min → 60min → permanent), strong password validation

**Authorization (`rbac/`):**
- Built-in roles with permission inheritance
- Custom roles with granular permission scopes
- Middleware: `requireRole()`, `requireScopes()`, `hasPermission()`

### API Gateway (`gateway/`)

API management layer for external integrations.

- **API key management**: Create, rotate, revoke; scoped by environment (development/staging/production)
- **API versioning**: Version middleware with deprecation warnings and sunset dates
- **Rate limiting**: Per-tenant, per-plan limits with burst allowance
- **Request logging**: Structured request/response logging with event handlers
- **Error handling**: Standardized `ApiError` responses with machine-readable types

### Background Processing (`queue/`)

Job queue system for async operations.

**7 specialized processors:**
| Processor | Purpose |
|-----------|---------|
| `usage-processor` | Aggregate and store usage metrics |
| `webhook-processor` | Deliver webhooks with retries |
| `agent-lifecycle-processor` | Handle agent start/stop lifecycle |
| `report-processor` | Generate usage and analytics reports |
| `email-processor` | Send transactional and drip emails |
| `notification-processor` | Dispatch in-app and push notifications |
| `scheduled` | Run cron-scheduled jobs |

### Event Streaming (`events/`)

Real-time event pub/sub system for internal and external consumers.

- `EventPublisher` — Publish typed events (transcription, response, state changes, metrics, usage alerts)
- `EventSubscriber` — Subscribe with glob-pattern filtering
- `EventBuffer` — Buffer events for batch delivery
- `ConnectionManager` — Manage SSE/WebSocket connections with per-tenant limits

### Webhooks (`webhooks/`)

Outbound webhook system for integrating with external services.

- Webhook registration and management
- HMAC signature signing for payload verification
- Delivery with exponential backoff retries
- Delivery tracking via `WebhookDeliveryRepository`

### Billing & Usage (`billing/`)

Usage metering and cost tracking tied to plan tiers.

- **8 metered dimensions**: session_minutes, llm_tokens, stt_minutes, tts_characters, api_calls, storage, webhooks, compute
- Quota enforcement with alerts at 50%, 75%, 90%, 100% thresholds
- Per-plan rate limits for API endpoints
- Overage billing support
- Provider-level cost tracking via `CostTracker`

### Observability (`observability/`)

Structured logging, metrics, and monitoring.

- **Logging**: Pino-based structured logging with field redaction (secrets, tokens, passwords)
- **Metrics**: `MetricsCollector` with counters, histograms, gauges; Prometheus-compatible export
- **Transport**: `SocketLogTransport` forwards logs over Socket.IO for real-time dashboard streaming
- **Infrastructure**: Docker Compose profiles for Prometheus + Grafana monitoring

### Audit & Compliance (`audit/`)

Tamper-evident audit trail and data governance.

- **Hash-chain integrity**: Each audit entry is chained to the previous via SHA-256 hash, enabling tamper detection
- **Retention policies**: Configurable retention with automated enforcement and archival
- **GDPR compliance**: `ComplianceService` with data export (full user data dump) and deletion (right to erasure)
- **Security alerts**: Routing to configurable alert channels (email, webhook, Slack)
- **Severity levels**: Audit events categorized by severity for filtering and alerting

---

## Specialized Features

### Memory & RAG (`memory/`)

Persistent agent memory with semantic retrieval.

- `MemoryStore` — Store and retrieve memories with metadata and timestamps
- `KnowledgeBase` — Index documents, chunk and embed for retrieval
- `EmbeddingClient` — Generate vector embeddings via external providers
- `ContextRetriever` — Cosine similarity search for relevant context injection
- `MemoryExtractor` — Extract memorable facts from conversations

### Analytics (`analytics/`)

Real-time conversation intelligence.

- Sentiment scoring and trend computation
- Topic analysis and speaker analytics
- Highlight detection (key moments) and risk flag detection
- Action item and key decision extraction
- Rule-based summary generation and recommendations
- `RealtimeAnalyticsProcessor` for live streaming analytics

### Agent Builder (`builder/`)

No-code visual agent configuration.

- Flow-based agent design with 5 node types: Trigger, Listener, Processor, Responder, Modifier
- `transpileFlowToConfig()` — Convert visual flows to `AgentConfig` objects
- Template library with categorized starter flows
- Flow validation with detailed error reporting

### Translation (`translation/`)

Real-time multilingual support for 50+ languages.

- `LanguageDetector` — Automatic language identification
- `TranslationService` — Translation with glossary and formality support
- 3 provider backends: DeepL, Google Translate, OpenAI
- Middleware integration: `createTranslationMiddleware()` for pipeline injection

### Voice Cloning (`voice/`)

Custom voice synthesis with consent management.

- `VoiceService` — Voice synthesis and cloning operations
- `VoiceConsentManager` — Track and enforce voice cloning consent

### Reseller / White-Label (`reseller/`)

Platform reselling and custom branding.

- `ResellerService` — Manage reseller accounts with wholesale discount tiers
- `CustomDomainService` — Custom domain provisioning with DNS record management
- `ImpersonationService` — Support impersonation for debugging customer setups
- White-label config: logos, colors, fonts, email senders, custom fields

### Onboarding & Growth (`onboarding/`)

Product-led growth engine.

- Welcome wizard with use-case detection and template recommendations
- Activation tracking across key milestones
- Drip email campaigns with condition-based scheduling
- Referral program with credit tracking ($5 credits, 90-day expiry)
- Upgrade triggers based on usage patterns (quota exhaustion, feature attempts)
- Product analytics: funnel metrics, event tracking, conversion attribution

### Marketplace

App distribution platform (implemented via server routes + DB repositories).

- Marketplace listing with search, categories, and featured apps
- Installation tracking and review system with ratings
- Publisher payout management

### Hosting & CI/CD (`hosting/`, `cicd/`)

Agent deployment and version management.

- `DeploymentManager` — Deploy agents to managed infrastructure
- `CICDService` — Version management with promote/rollback, canary deployments
- `AgentTestRunner` — Run test suites against agent versions before deployment

---

## Data Architecture

### PostgreSQL (via Drizzle ORM)

Primary persistence for platform data. Schema defined in `packages/core/src/db/schema.ts`.

**26 repository classes** organized by domain:
- **Core**: Organization, User, Agent, Session, Conversation
- **Access**: Member, CustomRole, Invitation, Team, ApiKey
- **Usage**: Usage, Analytics, Audit
- **Marketplace**: MarketplaceListing, MarketplaceInstall, MarketplaceReview, PublisherPayout
- **Deployment**: AgentVersion, AgentDeployment
- **Reseller**: Reseller, SubOrganization, CustomDomain, AgentTemplate, ImpersonationSession
- **Infrastructure**: Tenant, WebhookDelivery

Connection pooling: 5-20 connections, 30s idle timeout, 5s connect timeout.

### Redis (via ioredis)

Session caching, rate limiting, and pub/sub.

- JSON get/set helpers with TTL support
- Rate limiting: `checkRedisRateLimit()` for API and auth endpoints
- Health checks: `checkRedisHealth()`
- Key prefix support for multi-environment isolation

### Tenant Data Isolation

- Async context propagation via `runWithTenant()` / `getTenantContext()`
- Repository-level query scoping by `orgId`
- Automated isolation verification: `runIsolationChecks()` validates no cross-tenant data leakage

### File-Based Persistence (SDK Level)

The SDK core's built-in persistence remains file-based:
- Conversation history: JSON files via `ConversationStore`
- Browser cookies: AES-encrypted via `SecureCookieStore`
- Agent personality presets: JSON files in `personalities/`

---

## Server Routes (`packages/server/src/routes/`)

| Route File | Purpose |
|------------|---------|
| `analytics.ts` | Usage analytics and conversation insights |
| `builder.ts` | Agent builder CRUD and flow management |
| `deployments.ts` | Agent deployment and version management |
| `events.ts` | SSE event streaming endpoints |
| `marketplace.ts` | App listing, installation, reviews |
| `onboarding.ts` | Onboarding flow and wizard endpoints |
| `org.ts` | Organization management (CRUD, members, plans) |
| `personalities.ts` | Agent personality presets |
| `reseller.ts` | White-label and reseller management |
| `usage.ts` | Usage tracking and quota status |
| `voices.ts` | Voice management and cloning |

All routes use Zod validation schemas (in `packages/server/src/schemas/`) and require authentication via API key or JWT.

---

## Examples (12 projects)

| Example | Description |
|---------|-------------|
| `basic-join/` | Minimal agent joining a Space |
| `chrome-connect/` | Connect to existing Chrome via DevTools Protocol |
| `custom-provider/` | Implement and use a custom LLM provider |
| `discord-bridge/` | Forward Space transcriptions to Discord |
| `express-integration/` | Embed agent in an Express.js server |
| `middleware-pipeline/` | Compose middleware for audio/text processing |
| `multi-agent/` | Multiple agents in the same Space |
| `multi-agent-debate/` | Agents debating each other |
| `plugins/` | Analytics, moderation, and webhook plugins |
| `scheduled-spaces/` | Join Spaces on a schedule |
| `transcription-logger/` | Log all Space transcriptions |
| `with-plugins/` | Plugin system demonstration |

---

## Where to Find What

| I want to... | Look at... |
|--------------|------------|
| Understand the SDK core | [CLAUDE.md](../CLAUDE.md), [packages/core/CLAUDE.md](../packages/core/CLAUDE.md) |
| Add a new LLM/STT/TTS provider | `packages/core/src/pipeline/` — implement interface, add to factory |
| Add a new API endpoint | `packages/server/src/routes/` + `packages/server/src/schemas/` |
| Understand the database schema | `packages/core/src/db/schema.ts` |
| Add enterprise features | This document (Tier 2 section), `packages/core/src/<module>/` |
| See working examples | `examples/` directory |
| Deploy with Docker | `docker/`, [docs/docker-deployment.md](./docker-deployment.md) |
| Understand the admin panel | [packages/server/CLAUDE.md](../packages/server/CLAUDE.md) |
| Understand the legacy code | `src/`, `server.js`, [docs/sdk-design-spec.md](./sdk-design-spec.md) (historical) |

---

## Historical Context

This project evolved through several phases:
1. **Monolith** ("Swarmsy") — Single `server.js` running X Space agent + Talky Show comedy system
2. **SDK refactor** — Extracted into `packages/core` as a publishable npm SDK (see [sdk-design-spec.md](./sdk-design-spec.md))
3. **Enterprise platform** — Added multi-tenancy, auth, billing, marketplace, and 15+ platform modules

Legacy docs describing earlier phases are preserved in `docs/` with deprecation banners.


