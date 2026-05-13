// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§78]

import express from 'express'
import http from 'http'
import cors from 'cors'
import helmet from 'helmet'
import { Server } from 'socket.io'
import path from 'path'
import { XSpaceAgent, BrowserLifecycle, redactSecrets } from 'xspace-agent'
import type { AgentConfig, AgentStatus, VoiceConfig } from 'xspace-agent'
import {
  getAppLogger,
  getMetrics,
  startProcessMetrics,
  createStreamingLogger,
  setAppLogger,
  initDatabase,
  initRedis,
  checkDatabaseHealth,
  checkRedisHealth,
  closeDatabase,
  closeRedis,
} from 'xspace-agent'
import { randomUUID } from 'crypto'

import { createAuthMiddleware, socketAuthMiddleware } from './middleware/auth'
import { validateSocketEvent, SpaceUrlSchema, validate } from './middleware/validation'
import { RateLimiter, rateLimitMiddleware } from './middleware/rate-limit'
import { requestIdMiddleware } from './middleware/request-id'
import { globalErrorHandler, buildErrorResponse } from './middleware/error-handler'
import {
  AgentIdParamSchema,
  SetPersonalityBodySchema,
  OverrideSelectorParamsSchema,
  OverrideSelectorBodySchema,
  CostQuerySchema,
} from './schemas'
import { createMarketplaceRoutes } from './routes/marketplace'
import { PersonalityLoader } from './personalities'
import type { PersonalityWithMeta } from './personalities'
import { createPersonalityRouter } from './routes/personalities'
import { createOnboardingRouter } from './routes/onboarding'
import { createDeploymentRoutes } from './routes/deployments'
import { createBuilderRouter } from './routes/builder'
import { createAnalyticsRoutes } from './routes/analytics'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ServerOptions {
  port?: number
  headless?: boolean
  verbose?: boolean
}

export interface XSpaceServer {
  start(): Promise<void>
  stop(): Promise<void>
  getApp(): express.Express
  getIO(): Server
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createServer(options: ServerOptions = {}): XSpaceServer {
  const PORT = options.port ?? parseInt(process.env.PORT || '3000', 10)
  const AI_PROVIDER = (process.env.AI_PROVIDER || 'openai') as 'openai' | 'claude' | 'groq'
  const ADMIN_API_KEY = process.env.ADMIN_API_KEY || ''

  if (options.headless !== undefined) {
    process.env.HEADLESS = String(options.headless)
  }

  // -------------------------------------------------------------------------
  // Express + HTTP setup
  // -------------------------------------------------------------------------

  const app = express()
  const server = http.createServer(app)

  // --- Security headers (CSP, X-Frame-Options, etc.) ---
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          connectSrc: ["'self'", 'wss:', 'ws:'],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  )

  // --- CORS ---
  const corsOrigins: string[] = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
    : [`http://localhost:${PORT}`]

  // Auto-detect Railway public domain so WebSocket upgrades aren't CORS-blocked
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN
  if (railwayDomain && !corsOrigins.includes(`https://${railwayDomain}`)) {
    corsOrigins.push(`https://${railwayDomain}`)
  }

  app.use(
    cors({
      origin: corsOrigins,
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'X-API-Key', 'Authorization'],
      credentials: true,
    }),
  )

  // -------------------------------------------------------------------------
  // Socket.IO setup (with CORS + auth) — must be created before the streaming
  // logger so it can attach a transport to the Socket.IO server.
  // -------------------------------------------------------------------------

  const io = new Server(server, {
    cors: {
      origin: corsOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 5e6,
  })

  // --- Structured logging + metrics ---
  const streamingLogger = createStreamingLogger('xspace-server', io, process.env.LOG_LEVEL ?? 'info')
  setAppLogger(streamingLogger)
  const log = getAppLogger('server')
  startProcessMetrics()

  // -------------------------------------------------------------------------
  // Environment validation
  // -------------------------------------------------------------------------

  function validateEnvironment(): void {
    if (!ADMIN_API_KEY) {
      log.warn('ADMIN_API_KEY is not set — admin endpoints will be disabled. Generate with: openssl rand -hex 32')
    } else if (ADMIN_API_KEY.length < 16) {
      log.warn('ADMIN_API_KEY is too short (<16 chars) — generate with: openssl rand -hex 32')
    }

    if (!process.env.X_AUTH_TOKEN && !process.env.X_USERNAME) {
      log.warn('no X authentication configured (X_AUTH_TOKEN or X_USERNAME) — agent will not be able to join Spaces')
    }

    const providerKeyMap: Record<string, string | undefined> = {
      openai: process.env.OPENAI_API_KEY,
      'openai-chat': process.env.OPENAI_API_KEY,
      claude: process.env.ANTHROPIC_API_KEY,
      groq: process.env.GROQ_API_KEY,
    }
    if (!providerKeyMap[AI_PROVIDER]) {
      log.warn({ provider: AI_PROVIDER }, 'no API key set for AI provider')
    }
  }

  validateEnvironment()

  // -------------------------------------------------------------------------
  // Database + Redis initialization (optional — degrades gracefully)
  // -------------------------------------------------------------------------

  let dbInitialized = false
  let redisInitialized = false

  function initDataStores(): void {
    if (process.env.DATABASE_URL) {
      try {
        initDatabase({ connectionString: process.env.DATABASE_URL })
        dbInitialized = true
        log.info('PostgreSQL connection pool initialized')
      } catch (err: any) {
        log.warn({ err: err.message }, 'failed to initialize PostgreSQL — running without database')
      }
    }

    if (process.env.REDIS_URL) {
      try {
        const redis = initRedis({ url: process.env.REDIS_URL })
        redis.connect().catch((err: Error) => {
          log.warn({ err: err.message }, 'Redis connection failed — running without Redis')
        })
        redisInitialized = true
        log.info('Redis client initialized')
      } catch (err: any) {
        log.warn({ err: err.message }, 'failed to initialize Redis — running without cache')
      }
    }
  }

  initDataStores()

  // --- Request ID middleware ---
  app.use(requestIdMiddleware)

  // --- Rate limiting (100 requests per minute per IP) ---
  const apiLimiter = new RateLimiter(
    parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
    parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
  )
  app.use(rateLimitMiddleware(apiLimiter))

  // --- Static files & body parsing ---
  app.use(express.static(path.join(__dirname, '..', 'public')))
  app.use(express.json())

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  interface SpaceMessage {
    id: string
    agentId: number
    name: string
    text: string
    timestamp: number
    isUser?: boolean
  }

  const state = {
    agent: null as XSpaceAgent | null,
    status: 'disconnected' as AgentStatus,
    messages: [] as SpaceMessage[],
    spaceUrl: null as string | null,
    startedAt: null as number | null,
    totalCost: 0,
  }

  // Runtime settings — mutable in-memory overrides for environment variables.
  // These do NOT persist across server restarts; use env vars for that.
  const runtimeSettings = {
    auth: {
      method: (process.env.X_AUTH_TOKEN ? 'cookie' : 'credentials') as 'cookie' | 'credentials',
    },
    apiKeys: {} as Record<string, string>,
    behavior: {
      aiProvider: AI_PROVIDER as string,
      sttProvider: (process.env.STT_PROVIDER || 'groq') as string,
      ttsProvider: (process.env.TTS_PROVIDER || 'elevenlabs') as string,
      headless: process.env.HEADLESS !== 'false',
      autoJoin: false,
    },
    systemPrompt: process.env.SYSTEM_PROMPT || '',
  }

  // -------------------------------------------------------------------------
  // Personality system
  // -------------------------------------------------------------------------

  const personalityLoader = new PersonalityLoader()
  const agentPersonalities: Record<number, PersonalityWithMeta | null> = {
    0: null,
    1: null,
  }

  // -------------------------------------------------------------------------
  // Routes — unauthenticated
  // -------------------------------------------------------------------------

  app.get('/health', async (_req, res) => {
    const [dbHealth, redisHealth] = await Promise.allSettled([
      dbInitialized ? checkDatabaseHealth() : Promise.resolve(null),
      redisInitialized ? checkRedisHealth() : Promise.resolve(null),
    ])

    const db = dbHealth.status === 'fulfilled' ? dbHealth.value : { ok: false, error: 'check failed' }
    const redis = redisHealth.status === 'fulfilled' ? redisHealth.value : { ok: false, error: 'check failed' }

    const allHealthy = (!db || db.ok !== false) && (!redis || redis.ok !== false)

    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? 'ok' : 'degraded',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      agent: state.status,
      ...(db && { database: db }),
      ...(redis && { redis }),
    })
  })

  app.get('/metrics', (_req, res) => {
    res.set('Content-Type', 'text/plain; version=0.0.4')
    res.send(getMetrics().toPrometheus())
  })

  app.get('/metrics/json', (_req, res) => {
    res.json(getMetrics().toJSON())
  })

  // -------------------------------------------------------------------------
  // Routes — authenticated
  // -------------------------------------------------------------------------

  if (ADMIN_API_KEY) {
    app.use('/admin', createAuthMiddleware(ADMIN_API_KEY))
    app.use('/state', createAuthMiddleware(ADMIN_API_KEY))
    app.use('/api/personalities', createAuthMiddleware(ADMIN_API_KEY))
    app.use('/api/agents', createAuthMiddleware(ADMIN_API_KEY))
    app.use('/api/deployments', createAuthMiddleware(ADMIN_API_KEY))
    app.use('/api/builder', createAuthMiddleware(ADMIN_API_KEY))
    app.use('/api/settings', createAuthMiddleware(ADMIN_API_KEY))
  }

  app.get('/', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')))
  app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')))
  app.get('/builder', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'builder.html')))

  app.get('/config', (_req, res) =>
    res.json({
      aiProvider: AI_PROVIDER,
      status: state.status,
    }),
  )

  app.get('/state', (_req, res) =>
    res.json({
      status: state.status,
      spaceUrl: state.spaceUrl,
      messages: state.messages.slice(-50),
    }),
  )

  // -------------------------------------------------------------------------
  // Settings API — read / write runtime configuration
  // -------------------------------------------------------------------------

  app.get('/api/settings', (_req, res) => {
    res.json({
      auth: {
        method: runtimeSettings.auth.method,
        hasAuthToken: !!(process.env.X_AUTH_TOKEN),
        hasCt0: !!(process.env.X_CT0),
        hasUsername: !!(process.env.X_USERNAME),
        hasPassword: !!(process.env.X_PASSWORD),
      },
      apiKeys: {
        hasOpenai: !!(process.env.OPENAI_API_KEY || runtimeSettings.apiKeys.openai),
        hasAnthropic: !!(process.env.ANTHROPIC_API_KEY || runtimeSettings.apiKeys.anthropic),
        hasGroq: !!(process.env.GROQ_API_KEY || runtimeSettings.apiKeys.groq),
        hasElevenlabs: !!(process.env.ELEVENLABS_API_KEY || runtimeSettings.apiKeys.elevenlabs),
      },
      behavior: { ...runtimeSettings.behavior },
      systemPrompt: runtimeSettings.systemPrompt,
    })
  })

  app.post('/api/settings', (req, res) => {
    const { section, data } = req.body || {}
    if (!section || !data) {
      res.status(400).json(buildErrorResponse('VALIDATION_ERROR', 'Missing section or data'))
      return
    }

    const updated: string[] = []

    switch (section) {
      case 'auth': {
        if (data.method) runtimeSettings.auth.method = data.method
        if (data.authToken) { process.env.X_AUTH_TOKEN = data.authToken; updated.push('X_AUTH_TOKEN') }
        if (data.ct0) { process.env.X_CT0 = data.ct0; updated.push('X_CT0') }
        if (data.username) { process.env.X_USERNAME = data.username; updated.push('X_USERNAME') }
        if (data.password) { process.env.X_PASSWORD = data.password; updated.push('X_PASSWORD') }
        if (data.method) updated.push('auth method')
        break
      }
      case 'apiKeys': {
        if (data.openai) { process.env.OPENAI_API_KEY = data.openai; runtimeSettings.apiKeys.openai = data.openai; updated.push('OpenAI') }
        if (data.anthropic) { process.env.ANTHROPIC_API_KEY = data.anthropic; runtimeSettings.apiKeys.anthropic = data.anthropic; updated.push('Anthropic') }
        if (data.groq) { process.env.GROQ_API_KEY = data.groq; runtimeSettings.apiKeys.groq = data.groq; updated.push('Groq') }
        if (data.elevenlabs) { process.env.ELEVENLABS_API_KEY = data.elevenlabs; runtimeSettings.apiKeys.elevenlabs = data.elevenlabs; updated.push('ElevenLabs') }
        break
      }
      case 'behavior': {
        if (data.aiProvider) { runtimeSettings.behavior.aiProvider = data.aiProvider; updated.push('AI provider') }
        if (data.sttProvider) { runtimeSettings.behavior.sttProvider = data.sttProvider; updated.push('STT provider') }
        if (data.ttsProvider) { runtimeSettings.behavior.ttsProvider = data.ttsProvider; updated.push('TTS provider') }
        if (data.headless !== undefined) {
          runtimeSettings.behavior.headless = data.headless
          process.env.HEADLESS = String(data.headless)
          updated.push('headless')
        }
        if (data.autoJoin !== undefined) { runtimeSettings.behavior.autoJoin = data.autoJoin; updated.push('auto-join') }
        break
      }
      case 'systemPrompt': {
        if (typeof data.prompt === 'string') {
          runtimeSettings.systemPrompt = data.prompt
          process.env.SYSTEM_PROMPT = data.prompt
          updated.push('system prompt')
          // Hot-swap into running agent if possible
          if (state.agent) {
            try {
              const agent = state.agent as any
              if (agent.config?.ai) agent.config.ai.systemPrompt = data.prompt
            } catch { /* best effort */ }
          }
        }
        break
      }
      case 'voice': {
        if (data.ttsProvider) { runtimeSettings.behavior.ttsProvider = data.ttsProvider; updated.push('TTS provider') }
        if (data.voiceId) { process.env.VOICE_ID = data.voiceId; updated.push('voice ID') }
        if (data.speed !== undefined) { updated.push('voice speed') }
        if (data.llmProvider) { runtimeSettings.behavior.aiProvider = data.llmProvider; updated.push('LLM provider') }
        if (data.llmModel) { process.env.AI_MODEL = data.llmModel; updated.push('LLM model') }
        // Hot-swap into running agent if possible
        if (state.agent) {
          try {
            const agent = state.agent as any
            if (data.ttsProvider && agent.config?.voice) agent.config.voice.provider = data.ttsProvider
            if (data.voiceId && agent.config?.voice) agent.config.voice.voiceId = data.voiceId
            if (data.speed !== undefined && agent.config?.voice) agent.config.voice.speed = data.speed
            if (data.llmProvider && agent.config?.ai) agent.config.ai.provider = data.llmProvider
            if (data.llmModel && agent.config?.ai) agent.config.ai.model = data.llmModel
          } catch { /* best effort */ }
        }
        break
      }
      default:
        res.status(400).json(buildErrorResponse('VALIDATION_ERROR', `Unknown section: ${section}`))
        return
    }

    if (updated.length === 0) {
      res.status(400).json(buildErrorResponse('VALIDATION_ERROR', 'No settings were updated — check your data'))
      return
    }

    log.info({ section, updated }, 'settings updated')
    emitLog('info', `Settings updated: ${updated.join(', ')}`)
    res.json({ success: true, updated })
  })

  // --- Marketplace routes ---
  app.use(createMarketplaceRoutes())

  // --- Personality CRUD endpoints ---
  app.use('/api/personalities', createPersonalityRouter(personalityLoader))

  // --- Deployment CI/CD endpoints ---
  app.use('/api/deployments', createDeploymentRoutes())

  // --- Onboarding & PLG endpoints ---
  app.use('/api', createOnboardingRouter())

  // --- No-code agent builder endpoints ---
  app.use('/api/builder', createBuilderRouter())

  // --- Conversation Intelligence Analytics endpoints ---
  app.use('/api', createAnalyticsRoutes())

  // -------------------------------------------------------------------------
  // Agent personality hot-swap endpoints
  // -------------------------------------------------------------------------

  app.get('/api/agents/:agentId/personality', validate(AgentIdParamSchema, 'params'), (req, res) => {
    const agentId = parseInt(req.params.agentId, 10)
    res.json({ agentId, personality: agentPersonalities[agentId] })
  })

  app.post('/api/agents/:agentId/personality', validate(AgentIdParamSchema, 'params'), validate(SetPersonalityBodySchema), (req, res) => {
    const agentId = parseInt(req.params.agentId, 10)
    const { personalityId, clearHistory } = (req as any).validated

    const personality = personalityLoader.get(personalityId)
    if (!personality) {
      res.status(404).json({ error: `Personality '${personalityId}' not found` })
      return
    }

    agentPersonalities[agentId] = personality
    const fullPrompt = [personality.systemPrompt, ...personality.context].join('\n\n')

    if (state.agent) {
      try {
        const agent = state.agent as any
        if (agent.config?.ai) {
          agent.config.ai.systemPrompt = fullPrompt
          if (personality.behavior.temperature !== undefined) {
            agent.config.ai.temperature = personality.behavior.temperature
          }
          if (personality.behavior.maxResponseTokens !== undefined) {
            agent.config.ai.maxTokens = personality.behavior.maxResponseTokens
          }
        }
        if (agent.config?.voice && personality.voice) {
          agent.config.voice.provider = personality.voice.provider
          if (personality.voice.voiceId) agent.config.voice.voiceId = personality.voice.voiceId
          if (personality.voice.speed !== undefined) agent.config.voice.speed = personality.voice.speed
          if (personality.voice.stability !== undefined) agent.config.voice.stability = personality.voice.stability
        }
        if (clearHistory) {
          agent.conversationManager?.clear?.()
        }
      } catch (err: any) {
        log.warn({ err: err.message, agentId }, 'partial hot-swap — some config changes may not apply until restart')
      }
    }

    spaceNS.emit('personality:changed', {
      agentId,
      personality: {
        id: personality.id,
        name: personality.name,
        description: personality.description,
      },
      timestamp: Date.now(),
    })

    emitLog('info', `Agent ${agentId} personality changed to "${personality.name}" (${personality.id})`)

    res.json({
      success: true,
      agentId,
      personality,
      hotSwapped: !!state.agent,
    })
  })

  // -------------------------------------------------------------------------
  // Selector admin endpoints
  // -------------------------------------------------------------------------

  app.post('/admin/selectors/:name', validate(OverrideSelectorParamsSchema, 'params'), validate(OverrideSelectorBodySchema), (req, res) => {
    if (!state.agent) {
      res.status(400).json(buildErrorResponse('NOT_FOUND', 'No agent running', {
        hint: 'Start an agent before overriding selectors',
        requestId: (req as any).id,
      }))
      return
    }

    const { name } = req.params
    const { selector } = (req as any).validated

    try {
      const lifecycle = (state.agent as any).browserLifecycle as BrowserLifecycle
      const engine = lifecycle.getSelectorEngine()
      engine.override(name, selector)
      res.json({ success: true, message: `Selector '${name}' overridden` })
    } catch (err: any) {
      res.status(500).json(buildErrorResponse('INTERNAL_ERROR', redactSecrets(err.message), {
        requestId: (req as any).id,
      }))
    }
  })

  app.get('/admin/selectors/health', async (_req, res) => {
    if (!state.agent) {
      res.status(400).json({ error: 'No agent running' })
      return
    }

    try {
      const lifecycle = (state.agent as any).browserLifecycle as BrowserLifecycle
      const engine = lifecycle.getSelectorEngine()
      const page = lifecycle.getPage()

      if (!page) {
        res.status(400).json({ error: 'No browser page available' })
        return
      }

      const { validateSelectors } = await import('xspace-agent/dist/browser/selector-engine')
      const report = await validateSelectors(page, engine)
      res.json(report)
    } catch (err: any) {
      try {
        const lifecycle = (state.agent as any).browserLifecycle as BrowserLifecycle
        const engine = lifecycle.getSelectorEngine()
        res.json({
          error: redactSecrets(err.message),
          failureLog: engine.getFailureReport(),
          timestamp: Date.now(),
        })
      } catch {
        res.status(500).json({ error: redactSecrets(err.message) })
      }
    }
  })

  app.get('/admin/selectors/failures', (_req, res) => {
    if (!state.agent) {
      res.status(400).json({ error: 'No agent running' })
      return
    }

    try {
      const lifecycle = (state.agent as any).browserLifecycle as BrowserLifecycle
      const engine = lifecycle.getSelectorEngine()
      res.json({ failures: engine.getFailureReport() })
    } catch (err: any) {
      res.status(500).json({ error: redactSecrets(err.message) })
    }
  })

  // -------------------------------------------------------------------------
  // Provider management endpoints
  // -------------------------------------------------------------------------

  app.get('/admin/providers', (_req, res) => {
    if (!state.agent) { res.status(400).json({ error: 'No agent running' }); return }
    try {
      res.json({
        providers: state.agent.getProviderStatus(),
        costs: state.agent.getCostSummary(),
        sessionDuration: state.startedAt ? (Date.now() - state.startedAt) / 1000 : 0,
      })
    } catch (err: any) { res.status(500).json({ error: redactSecrets(err.message) }) }
  })

  app.get('/admin/providers/costs', (req, res) => {
    if (!state.agent) { res.status(400).json({ error: 'No agent running' }); return }
    try {
      const sinceMs = req.query.since ? parseInt(req.query.since as string, 10) : undefined
      const tracker = state.agent.getCostTracker()
      res.json({
        summary: state.agent.getCostSummary(sinceMs),
        estimatedHourlyCost: tracker.estimateSessionCost(60),
        entries: tracker.getEntries().slice(-100),
      })
    } catch (err: any) { res.status(500).json({ error: redactSecrets(err.message) }) }
  })

  app.get('/admin/providers/health', (_req, res) => {
    if (!state.agent) { res.status(400).json({ error: 'No agent running' }); return }
    try {
      const monitor = state.agent.getProviderHealthMonitor()
      res.json({
        results: monitor.getAllResults(),
        providerStatus: state.agent.getProviderStatus(),
      })
    } catch (err: any) { res.status(500).json({ error: redactSecrets(err.message) }) }
  })

  // -------------------------------------------------------------------------
  // Global error handler (standardised error format — must be registered last)
  // -------------------------------------------------------------------------

  app.use(globalErrorHandler)

  // -------------------------------------------------------------------------
  // Build TTS fallback chain from available API keys
  // -------------------------------------------------------------------------

  function buildTTSFallbackChain(primary: string): VoiceConfig[] {
    const candidates: VoiceConfig[] = [
      { provider: 'openai', apiKey: process.env.OPENAI_API_KEY },
      { provider: 'elevenlabs', apiKey: process.env.ELEVENLABS_API_KEY },
      { provider: 'groq', apiKey: process.env.GROQ_API_KEY },
    ]
    // Return all providers except the primary, but only if they have an API key
    return candidates.filter((c) => c.provider !== primary && c.apiKey)
  }

  // -------------------------------------------------------------------------
  // Build agent config from environment
  // -------------------------------------------------------------------------

  function buildAgentConfig(agentId?: number): AgentConfig {
    const personality = agentId !== undefined ? agentPersonalities[agentId] : null

    let systemPrompt =
      process.env.SYSTEM_PROMPT ||
      'You are a helpful AI assistant participating in an X Space. Keep responses short and conversational.'
    let maxTokens = process.env.MAX_TOKENS ? parseInt(process.env.MAX_TOKENS) : 300
    let temperature: number | undefined
    let voiceProvider = (process.env.TTS_PROVIDER as any) || 'openai'
    let voiceId = process.env.VOICE_ID
    let voiceSpeed: number | undefined
    let voiceStability: number | undefined

    if (personality) {
      systemPrompt = [personality.systemPrompt, ...personality.context].join('\n\n')
      if (personality.behavior.maxResponseTokens !== undefined) maxTokens = personality.behavior.maxResponseTokens
      if (personality.behavior.temperature !== undefined) temperature = personality.behavior.temperature
      if (personality.voice) {
        voiceProvider = personality.voice.provider
        if (personality.voice.voiceId) voiceId = personality.voice.voiceId
        if (personality.voice.speed !== undefined) voiceSpeed = personality.voice.speed
        if (personality.voice.stability !== undefined) voiceStability = personality.voice.stability
      }
    }

    return {
      auth: {
        token: process.env.X_AUTH_TOKEN,
        ct0: process.env.X_CT0,
        username: process.env.X_USERNAME,
        password: process.env.X_PASSWORD,
        email: process.env.X_EMAIL,
      },
      ai: {
        provider: AI_PROVIDER,
        apiKey:
          process.env.OPENAI_API_KEY ||
          process.env.ANTHROPIC_API_KEY ||
          process.env.GROQ_API_KEY ||
          '',
        model: process.env.AI_MODEL,
        systemPrompt,
        maxTokens,
        temperature,
      },
      voice: {
        provider: voiceProvider,
        apiKey: process.env.ELEVENLABS_API_KEY || process.env.OPENAI_API_KEY,
        voiceId,
        speed: voiceSpeed,
        stability: voiceStability,
        fallback: buildTTSFallbackChain(voiceProvider),
      },
      browser: {
        headless: process.env.HEADLESS !== 'false',
      },
      behavior: {
        autoRespond: true,
        silenceThreshold: 1.5,
      },
    }
  }

  // -------------------------------------------------------------------------
  // Socket.IO namespace with auth + validation
  // -------------------------------------------------------------------------

  const spaceNS = io.of('/space')

  if (ADMIN_API_KEY) {
    spaceNS.use(socketAuthMiddleware(ADMIN_API_KEY))
  }

  const socketLimiter = new RateLimiter(30, 10_000)

  function emitLog(level: string, message: string, context?: any) {
    spaceNS.emit('log', { level, message: redactSecrets(message), timestamp: Date.now(), context })
  }

  function attachAgentDashboardEvents(agent: XSpaceAgent) {
    agent.on('status', (status: AgentStatus) => {
      const history = agent.getTransitionHistory(1)
      if (history.length > 0) {
        const last = history[history.length - 1]
        spaceNS.emit('state:change', {
          from: last.from,
          to: last.to,
          event: last.event,
          timestamp: last.timestamp,
        })
      }
    })

    agent.on('audio:level' as any, (data: any) => {
      spaceNS.emit('audio:level', data)
    })

    agent.on('audio:webrtc-stats' as any, (data: any) => {
      spaceNS.emit('audio:webrtc-stats', data)
    })

    agent.on('turn:decision' as any, (data: any) => {
      spaceNS.emit('turn:decision', data)
    })

    agent.on('provider:status' as any, (data: any) => {
      spaceNS.emit('provider:status', data)
    })

    agent.on('provider:cost' as any, (data: any) => {
      state.totalCost = data?.totalCost ?? state.totalCost
      spaceNS.emit('provider:cost', data)
    })

    agent.on('selectors:health' as any, (data: any) => {
      spaceNS.emit('selectors:health', data)
    })

    agent.on('circuit:state-change' as any, (data: any) => {
      spaceNS.emit('circuit:state-change', data)
    })

    agent.on('orchestrator:bot-status' as any, (data: any) => {
      spaceNS.emit('orchestrator:bot-status', data)
    })
    agent.on('orchestrator:speaking' as any, (data: any) => {
      spaceNS.emit('orchestrator:speaking', data)
    })
  }

  spaceNS.on('connection', (socket) => {
    log.info({ socketId: socket.id }, 'client connected')
    socket.join('admin')

    socket.emit('stateUpdate', {
      status: state.status,
      spaceUrl: state.spaceUrl,
    })
    socket.emit('messageHistory', state.messages.slice(-50))

    socket.emit('health', {
      status: state.status,
      uptime: state.startedAt ? (Date.now() - state.startedAt) / 1000 : 0,
      timestamp: Date.now(),
    })

    if (state.agent) {
      const history = state.agent.getTransitionHistory(20)
      history.forEach((t: { from: string; to: string; event: string; timestamp: number }) => {
        socket.emit('state:change', { from: t.from, to: t.to, event: t.event, timestamp: t.timestamp })
      })
    }

    function handleEvent<T>(
      eventName: string,
      handler: (data: T) => void | Promise<void>,
    ) {
      socket.on(eventName, async (data: unknown) => {
        const rl = socketLimiter.check(socket.id)
        if (!rl.allowed) {
          socket.emit('xSpacesError', { error: 'Rate limit exceeded. Slow down.' })
          return
        }

        const validation = validateSocketEvent(eventName, data)
        if (!validation.valid) {
          socket.emit('xSpacesError', { error: `Invalid payload: ${validation.error}` })
          return
        }

        try {
          await handler(validation.data as T)
        } catch (err: any) {
          socket.emit('xSpacesError', { error: redactSecrets(err.message) })
        }
      })
    }

    /** Create and wire up an agent instance (shared between connect and start). */
    function initAgent(): XSpaceAgent {
      const config = buildAgentConfig()
      const agent = new XSpaceAgent(config)
      state.agent = agent
      state.startedAt = Date.now()

      agent.on('status', (status: AgentStatus) => {
        state.status = status
        spaceNS.emit('xSpacesStatus', { status })
      })

      agent.on('transcription', ({ speaker, text }: { speaker: string; text: string }) => {
        const msg: SpaceMessage = {
          id: Date.now().toString(),
          agentId: -1,
          name: speaker,
          text,
          timestamp: Date.now(),
          isUser: true,
        }
        state.messages.push(msg)
        if (state.messages.length > 100) state.messages = state.messages.slice(-100)
        spaceNS.emit('textComplete', msg)
      })

      agent.on('response', ({ text }: { text: string }) => {
        const msg: SpaceMessage = {
          id: Date.now().toString(),
          agentId: 0,
          name: 'Agent',
          text,
          timestamp: Date.now(),
        }
        state.messages.push(msg)
        if (state.messages.length > 100) state.messages = state.messages.slice(-100)
        spaceNS.emit('textComplete', msg)
      })

      agent.on('error', (err: Error) => {
        log.error({ err }, 'agent error')
        spaceNS.emit('xSpacesError', { error: redactSecrets(err.message) })
        emitLog('error', err.message)
      })

      agent.on('space-ended', () => {
        spaceNS.emit('xSpacesStatus', { status: 'space-ended' })
        emitLog('warn', 'Space has ended')
        state.agent = null
      })

      attachAgentDashboardEvents(agent)
      return agent
    }

    handleEvent('xspace:connect', async () => {
      if (state.agent) {
        socket.emit('xSpacesError', { error: 'Agent already running' })
        return
      }
      const agent = initAgent()
      emitLog('info', 'Authenticating...')
      await agent.connect()
      emitLog('info', 'Authenticated — ready to join a Space')
      log.info('agent authenticated')
    })

    handleEvent<{ spaceUrl: string; listenOnly?: boolean }>('xspace:start', async ({ spaceUrl, listenOnly }) => {
      if (state.agent) {
        socket.emit('xSpacesError', { error: 'Agent already running' })
        return
      }

      const agent = initAgent()
      state.spaceUrl = spaceUrl

      getMetrics().counter('xspace_space_joins_total', 'Total Space join attempts')
      emitLog('info', 'Agent starting...')
      if (listenOnly) {
        await agent.joinAsListener(spaceUrl)
        emitLog('info', `Agent joined Space as listener: ${spaceUrl}`)
      } else {
        await agent.join(spaceUrl)
        emitLog('info', `Agent joined Space: ${spaceUrl}`)
      }
      log.info({ spaceUrl, listenOnly }, 'agent joined space')
    })

    handleEvent('xspace:stop', async () => {
      if (state.agent) {
        emitLog('info', 'Stopping agent...')
        await state.agent.destroy()
        state.agent = null
        state.status = 'disconnected'
        state.spaceUrl = null
        state.startedAt = null
        state.totalCost = 0
        spaceNS.emit('xSpacesStatus', { status: 'disconnected' })
      }
    })

    handleEvent<{ spaceUrl: string }>('xspace:join', async ({ spaceUrl }) => {
      if (!state.agent) {
        socket.emit('xSpacesError', { error: 'No agent running. Start bot first.' })
        return
      }
      emitLog('info', `Joining space: ${spaceUrl}`)
      await state.agent.join(spaceUrl)
      state.spaceUrl = spaceUrl
    })

    handleEvent<{ spaceUrl: string }>('xspace:join-listener', async ({ spaceUrl }) => {
      if (!state.agent) {
        // Auto-create agent if user skipped Authenticate
        initAgent()
      }
      emitLog('info', `Joining as listener: ${spaceUrl}`)
      await state.agent!.joinAsListener(spaceUrl)
      state.spaceUrl = spaceUrl
    })

    handleEvent('xspace:leave', async () => {
      if (state.agent) {
        emitLog('info', 'Leaving space...')
        await state.agent.leave()
        state.spaceUrl = null
      }
    })

    handleEvent('xspace:request-speak', async () => {
      if (!state.agent) {
        socket.emit('xSpacesError', { error: 'No agent running.' })
        return
      }
      emitLog('info', 'Requesting to speak (will auto-wait for approval and unmute)...')
      try {
        const ok = await state.agent.requestAndSpeak()
        emitLog(ok ? 'info' : 'warn', ok ? 'Speaker access granted — mic unmuted' : 'Could not get speaker access')
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        emitLog('error', `Request to speak failed: ${msg}`)
      }
    })

    handleEvent('xspace:unmute', async () => {
      if (!state.agent) {
        socket.emit('xSpacesError', { error: 'No agent running.' })
        return
      }
      emitLog('info', 'Aggressively unmuting mic...')
      const ok = await state.agent.unmuteMic()
      emitLog(ok ? 'info' : 'warn', ok ? 'Mic unmuted' : 'Failed to unmute')
    })

    handleEvent('xspace:mute', async () => {
      if (!state.agent) {
        socket.emit('xSpacesError', { error: 'No agent running.' })
        return
      }
      emitLog('info', 'Muting mic...')
      const ok = await state.agent.muteMic()
      emitLog(ok ? 'info' : 'warn', ok ? 'Mic muted' : 'Failed to mute')
    })

    handleEvent<{ code: string }>('xspace:2fa', ({ code }) => {
      if (state.agent) {
        state.agent.emit('2fa-code' as any, code)
        emitLog('info', '2FA code submitted')
      }
    })

    handleEvent('xspace:status', () => {
      socket.emit('xSpacesStatus', { status: state.status, spaceUrl: state.spaceUrl })
    })

    handleEvent<{ botId: string }>('orchestrator:force-speak', ({ botId }) => {
      if (state.agent) {
        state.agent.emit('orchestrator:force-speak' as any, { botId })
        emitLog('info', `Force speak: ${botId}`)
      }
    })

    handleEvent<{ text: string }>('xspace:message', async ({ text }) => {
      if (!state.agent) {
        socket.emit('xSpacesError', { error: 'No agent running. Start bot first.' })
        return
      }
      emitLog('info', `Manual message: ${text.slice(0, 100)}`)
      try {
        await state.agent.say(text)
        const msg: SpaceMessage = {
          id: Date.now().toString(),
          agentId: 0,
          name: 'Agent (manual)',
          text,
          timestamp: Date.now(),
        }
        state.messages.push(msg)
        if (state.messages.length > 100) state.messages = state.messages.slice(-100)
        spaceNS.emit('textComplete', msg)
      } catch (err: any) {
        socket.emit('xSpacesError', { error: `Failed to speak: ${redactSecrets(err.message)}` })
      }
    })

    socket.on('disconnect', () => {
      log.info({ socketId: socket.id }, 'client disconnected')
    })
  })

  // -------------------------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------------------------

  async function shutdown(signal: string) {
    log.info({ signal }, 'shutting down gracefully')
    apiLimiter.destroy()
    socketLimiter.destroy()
    if (state.agent) {
      log.info('destroying agent')
      await state.agent.destroy().catch((err: Error) =>
        log.error({ err }, 'error destroying agent'),
      )
      state.agent = null
    }
    await closeDatabase().catch(() => {})
    await closeRedis().catch(() => {})

    io.close()
    server.close(() => {
      log.info('HTTP server closed')
    })
  }

  // -------------------------------------------------------------------------
  // Auto-join Space on boot (replicates legacy server.js behaviour)
  // Set X_SPACE_URL env var to auto-join a Space 3 seconds after server start.
  // Requires auth credentials (X_AUTH_TOKEN+X_CT0 or X_USERNAME+X_PASSWORD).
  // -------------------------------------------------------------------------

  async function autoJoinSpace(spaceUrl: string): Promise<void> {
    if (state.agent) {
      log.warn('auto-join skipped — agent already running')
      return
    }

    log.info({ spaceUrl }, 'auto-joining Space on startup')

    const config = buildAgentConfig()
    const agent = new XSpaceAgent(config)
    state.agent = agent
    state.spaceUrl = spaceUrl
    state.startedAt = Date.now()

    agent.on('status', (status: AgentStatus) => {
      state.status = status
      spaceNS.emit('xSpacesStatus', { status })
    })

    agent.on('transcription', ({ speaker, text }: { speaker: string; text: string }) => {
      const msg: SpaceMessage = {
        id: Date.now().toString(),
        agentId: -1,
        name: speaker,
        text,
        timestamp: Date.now(),
        isUser: true,
      }
      state.messages.push(msg)
      if (state.messages.length > 100) state.messages = state.messages.slice(-100)
      spaceNS.emit('textComplete', msg)
    })

    agent.on('response', ({ text }: { text: string }) => {
      const msg: SpaceMessage = {
        id: Date.now().toString(),
        agentId: 0,
        name: 'Agent',
        text,
        timestamp: Date.now(),
      }
      state.messages.push(msg)
      if (state.messages.length > 100) state.messages = state.messages.slice(-100)
      spaceNS.emit('textComplete', msg)
    })

    agent.on('error', (err: Error) => {
      log.error({ err }, 'agent error')
      spaceNS.emit('xSpacesError', { error: redactSecrets(err.message) })
      emitLog('error', err.message)
    })

    agent.on('space-ended', () => {
      spaceNS.emit('xSpacesStatus', { status: 'space-ended' })
      emitLog('warn', 'Space has ended')
      state.agent = null
    })

    attachAgentDashboardEvents(agent)

    getMetrics().counter('xspace_space_joins_total', 'Total Space join attempts')
    emitLog('info', 'Auto-join: Agent starting...')
    await agent.join(spaceUrl)
    emitLog('info', `Auto-join: Agent joined Space: ${spaceUrl}`)
    log.info({ spaceUrl }, 'auto-join: agent joined space')
  }

  // -------------------------------------------------------------------------
  // Return server handle
  // -------------------------------------------------------------------------

  return {
    start(): Promise<void> {
      return new Promise((resolve) => {
        server.listen(PORT, () => {
          log.info({ port: PORT, aiProvider: AI_PROVIDER, authEnabled: !!ADMIN_API_KEY }, 'xspace-agent server started')
          log.info({ adminUrl: `http://localhost:${PORT}/admin`, metricsUrl: `http://localhost:${PORT}/metrics` }, 'endpoints available')

          // Auto-join Space if X_SPACE_URL is set (like legacy server.js)
          const autoJoinUrl = process.env.X_SPACE_URL
          if (autoJoinUrl) {
            const hasAuth = process.env.X_AUTH_TOKEN || (process.env.X_USERNAME && process.env.X_PASSWORD)
            if (hasAuth) {
              log.info({ spaceUrl: autoJoinUrl }, 'X_SPACE_URL set — will auto-join in 3 seconds')
              setTimeout(() => {
                autoJoinSpace(autoJoinUrl).catch((err) => {
                  log.error({ err }, 'auto-join failed')
                  emitLog('error', `Auto-join failed: ${err.message}`)
                })
              }, 3000)
            } else {
              log.warn('X_SPACE_URL set but no X auth credentials found — skipping auto-join')
            }
          }

          resolve()
        })
      })
    },

    async stop(): Promise<void> {
      await shutdown('programmatic')
    },

    getApp(): express.Express {
      return app
    },

    getIO(): Server {
      return io
    },
  }
}


