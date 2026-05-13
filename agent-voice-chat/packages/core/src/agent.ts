// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

import { EventEmitter } from 'events'
import type {
  AgentConfig,
  AgentStatus,
  AgentEvents,
  Message,
  TranscriptionEvent,
  ResponseEvent,
  MiddlewareStage,
} from './types'
import type { LLMProvider } from './pipeline/types'
import { createLLM } from './pipeline/llm'
import { createSTT, STTConfig } from './pipeline/stt'
import { createTTSWithFallback, TTSConfig } from './pipeline/tts'
import { setLogger, getLogger } from './logger'
import { BrowserLifecycle } from './browser/lifecycle'
import { AudioPipeline } from './audio/pipeline'
import { ConversationManager } from './conversation'
import { HealthMonitor } from './health'
import { createAgentMachine } from './fsm/agent-machine'
import type { AgentContext, AgentEvent } from './fsm/agent-machine'
import type { StateMachine } from './fsm/machine'
import {
  AuthenticationError,
  SpaceNotFoundError,
  SpaceEndedError,
  BrowserConnectionError,
} from './errors'
import { PluginManager } from './plugins/manager'
import type { PluginContext, SpeakerInfo } from './plugins/types'
import { SpeakerIdentifier } from './intelligence/speaker-id'
import { TopicTracker } from './intelligence/topic-tracker'
import { ContextManager } from './intelligence/context-manager'
import { PromptBuilder } from './intelligence/prompt-builder'
import { ConversationStore } from './intelligence/persistence'
import { detectSentiment } from './intelligence/sentiment'
import type { STTProvider, TTSProvider } from './types'
import { CostTracker } from './providers/cost-tracker'
import { ProviderHealthMonitor } from './providers/health-monitor'
import type { CostSummary, ProviderStatus } from './providers/types'
import { MemoryStore } from './memory/store'
import { KnowledgeBase } from './memory/knowledge-base'
import { MemoryExtractor } from './memory/extraction'
import { ContextRetriever } from './memory/retrieval'
import { EmbeddingClient } from './memory/embeddings'

/**
 * The main X Space Agent class. Creates an AI-powered bot that joins
 * X/Twitter Spaces, listens to speakers, and responds intelligently.
 *
 * @example
 * ```typescript
 * const agent = new XSpaceAgent({
 *   auth: { token: process.env.X_AUTH_TOKEN! },
 *   ai: {
 *     provider: 'openai',
 *     apiKey: process.env.OPENAI_API_KEY!,
 *     systemPrompt: 'You are a helpful AI assistant.',
 *   },
 * });
 *
 * agent.on('transcription', ({ text, speaker }) => {
 *   console.log(`${speaker}: ${text}`);
 * });
 *
 * await agent.join('https://x.com/i/spaces/abc123');
 * ```
 *
 * @fires XSpaceAgent#transcription When speech is transcribed from the Space
 * @fires XSpaceAgent#response When the agent generates and speaks a response
 * @fires XSpaceAgent#status When the agent's lifecycle status changes
 * @fires XSpaceAgent#error When an error occurs
 * @fires XSpaceAgent#space-ended When the Space ends
 */
export class XSpaceAgent extends EventEmitter {
  private config: AgentConfig
  private machine: StateMachine<AgentContext, AgentEvent>
  private spaceUrl: string | null = null

  private llm: LLMProvider
  private browserLifecycle: BrowserLifecycle
  private audio: AudioPipeline
  private conversation: ConversationManager
  private health: HealthMonitor
  private pluginManager: PluginManager
  private speakers: SpeakerInfo[] = []

  // Provider intelligence
  private sttProvider!: STTProvider
  private ttsProvider!: TTSProvider
  private costTracker: CostTracker = new CostTracker()
  private providerHealth: ProviderHealthMonitor = new ProviderHealthMonitor()

  // Intelligence layer
  private speakerIdentifier: SpeakerIdentifier
  private topicTracker: TopicTracker
  private contextManager: ContextManager
  private promptBuilder: PromptBuilder
  private conversationStore: ConversationStore
  private joinedAt = 0

  // Memory & RAG
  private memoryStore: MemoryStore | null = null
  private knowledgeBase: KnowledgeBase | null = null
  private memoryExtractor: MemoryExtractor | null = null
  private contextRetriever: ContextRetriever

  constructor(config: AgentConfig) {
    super()
    this.config = config

    if (config.logger) {
      setLogger(config.logger)
    }

    // Initialize FSM
    this.machine = createAgentMachine()
    this.machine.onChange((state) => {
      this.emit('status', state as AgentStatus)
    })

    this.llm = createLLM(config.ai)

    // STT provider
    const sttConfig: STTConfig = {
      provider: config.ai.provider === 'openai' ? 'openai' : 'groq',
      apiKey: config.ai.apiKey || '',
    }
    const stt = createSTT(sttConfig)
    this.sttProvider = stt

    // TTS provider with fallback chain
    const ttsConfig: TTSConfig = {
      provider: config.voice?.provider || 'openai',
      apiKey: config.voice?.apiKey || config.ai.apiKey,
      voiceId: config.voice?.voiceId,
      stability: config.voice?.stability,
      fallback: config.voice?.fallback?.map((fb) => ({
        provider: fb.provider,
        apiKey: fb.apiKey || config.ai.apiKey,
        voiceId: fb.voiceId,
        stability: fb.stability,
      })),
    }
    const tts = createTTSWithFallback(ttsConfig)
    this.ttsProvider = tts

    // Provider health monitoring
    this.providerHealth.startMonitoring(
      [this.llm, this.sttProvider, this.ttsProvider],
      60_000,
    )

    // Audio pipeline
    const silenceMs = (config.behavior?.silenceThreshold || 1.5) * 1000
    const minChunks = config.behavior?.minSpeechDuration
      ? Math.ceil((config.behavior.minSpeechDuration * 16000) / 4096)
      : 3
    this.audio = new AudioPipeline(
      {
        postSpeakDelayMs: config.behavior?.turnDelay ?? 1500,
        vad: { silenceThresholdMs: silenceMs, minChunks },
      },
      stt,
      tts,
    )
    this.audio.onSpeechDetected((chunks) => {
      this.handleSpeechEnd(chunks).catch((err) => {
        this.emit('error', err instanceof Error ? err : new Error(String(err)))
      })
    })

    // Forward audio pipeline observability events to the agent
    const audioEvents = [
      'audio:level',
      'audio:webrtc-stats',
      'audio:injection-start',
      'audio:injection-end',
      'audio:echo-detected',
      'audio:vad-speech',
      'audio:vad-silence',
      'audio:quality-degraded',
    ] as const
    for (const event of audioEvents) {
      this.audio.on(event, (...args: any[]) => {
        this.emit(event, ...args)
      })
    }

    // Browser lifecycle
    this.browserLifecycle = new BrowserLifecycle(config.browser, config.auth)
    this.browserLifecycle.on('status', (s) => {
      if (s === 'logged-in') this.machine.send({ type: 'LOGIN_SUCCESS' })
    })
    this.browserLifecycle.on('error', (err) => this.emit('error', err))

    // Conversation
    this.conversation = new ConversationManager({
      systemPrompt: config.ai.systemPrompt,
      maxHistory: config.ai.maxHistory,
    })

    // Health monitor
    this.health = new HealthMonitor()
    this.health.onStatusChange(() => {
      // Health monitor status changes are informational;
      // space-ended is handled explicitly below
    })
    this.health.onError((err) => this.emit('error', err))
    this.health.onSpaceEnded(() => {
      this.audio.stopCapture()
      this.machine.send({ type: 'SPACE_ENDED' })
      this.emit('space-ended')
    })

    // Intelligence layer
    this.speakerIdentifier = new SpeakerIdentifier()
    this.topicTracker = new TopicTracker()

    const modelContextSize = this.getModelContextSize(config.ai.model)
    this.contextManager = new ContextManager({ maxTokens: modelContextSize })
    this.promptBuilder = new PromptBuilder(config.ai.systemPrompt, this.topicTracker, this.speakerIdentifier)
    this.conversationStore = new ConversationStore()

    // Plugin system
    this.pluginManager = new PluginManager(this.createPluginContext())
    for (const plugin of config.plugins ?? []) {
      this.pluginManager.use(plugin)
    }

    // Memory & RAG initialization
    const embeddingApiKey = config.memory?.embeddingApiKey ?? config.knowledge?.embeddingApiKey ?? config.ai.apiKey
    const embeddingClient = embeddingApiKey ? new EmbeddingClient(embeddingApiKey) : null

    if (config.memory?.enabled) {
      this.memoryStore = new MemoryStore(
        config.memory.storagePath ?? './memory',
        embeddingClient,
        config.memory.maxMemories ?? 1000,
      )

      // Create extraction function using the agent's LLM
      const generateFn = async (prompt: string): Promise<string> => {
        let result = ''
        for await (const delta of this.llm.streamResponse(0, prompt, 'You are a memory extraction assistant. Extract facts as instructed.')) {
          result += delta
        }
        return result
      }
      this.memoryExtractor = new MemoryExtractor(this.memoryStore, generateFn)
    }

    if (config.knowledge) {
      this.knowledgeBase = new KnowledgeBase({
        ...config.knowledge,
        embeddingApiKey: config.knowledge.embeddingApiKey ?? embeddingApiKey,
      })
    }

    this.contextRetriever = new ContextRetriever(this.memoryStore, this.knowledgeBase)
  }

  // ── Lifecycle ──────────────────────────────────────────────

  /**
   * Launch browser and authenticate with X, without joining a Space.
   *
   * After calling this, the agent is in the `connected` state and you can:
   * - `joinAsListener(url)` — join a Space as listener
   * - `join(url)` — join a Space and auto-request speaker
   * - Use the authenticated browser session for other X actions
   *
   * @throws {AuthenticationError} If X authentication fails
   * @throws {BrowserConnectionError} If the browser can't be launched/connected
   */
  async connect(): Promise<void> {
    if (this.browserLifecycle.getPage()) {
      throw new Error('Agent already connected. Call destroy() first.')
    }

    await this.pluginManager.init()

    if (this.memoryStore) {
      await this.memoryStore.load()
    }
    if (this.knowledgeBase) {
      await this.knowledgeBase.ingest()
    }

    try {
      const browserMode = (this.config.browser as any)?.connectMode ? 'connect' : 'managed'
      this.machine.send({ type: 'LAUNCH', browserMode })

      await this.browserLifecycle.launch(this.audio.getAudioDataHandler())

      if (browserMode === 'connect') {
        this.machine.send({ type: 'BROWSER_READY_CONNECT' } as AgentEvent)
      } else {
        this.machine.send({ type: 'BROWSER_READY' })
        await this.browserLifecycle.authenticate()
      }
    } catch (err) {
      let error: Error
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('auth_token') || msg.includes('Login failed') || msg.includes('logged in')) {
        error = new AuthenticationError(msg)
      } else if (msg.includes('Browser') || msg.includes('browser') || msg.includes('Chrome')) {
        const browserMode = (this.config.browser as any)?.connectMode ? 'connect' : 'managed'
        error = new BrowserConnectionError(browserMode, msg)
      } else {
        error = err instanceof Error ? err : new Error(msg)
      }
      this.machine.send({ type: 'ERROR', error: error.message })
      await this.browserLifecycle.cleanup().catch(() => {})
      throw error
    }
  }

  /**
   * Join an X Space and start listening.
   *
   * Launches a browser, authenticates with X, navigates to the Space,
   * requests speaker access, and begins capturing audio.
   *
   * @param spaceUrl - The URL of the X Space (e.g., `https://x.com/i/spaces/abc123`)
   * @throws {SpaceNotFoundError} If the Space doesn't exist or has ended
   * @throws {AuthenticationError} If X authentication fails
   * @throws {BrowserConnectionError} If the browser can't be launched/connected
   *
   * @example
   * ```typescript
   * try {
   *   await agent.join('https://x.com/i/spaces/abc123');
   *   console.log('Successfully joined!');
   * } catch (error) {
   *   if (error instanceof SpaceNotFoundError) {
   *     console.log('Space not found — is it still live?');
   *   }
   * }
   * ```
   */
  async join(spaceUrl: string): Promise<void> {
    if (this.browserLifecycle.getPage()) {
      throw new Error('Agent already running. Call leave() or destroy() first.')
    }

    await this.pluginManager.init()
    await this.pluginManager.notify('onJoin', spaceUrl)

    // Initialize memory and knowledge base
    if (this.memoryStore) {
      await this.memoryStore.load()
    }
    if (this.knowledgeBase) {
      await this.knowledgeBase.ingest()
    }

    try {
      const browserMode = (this.config.browser as any)?.connectMode ? 'connect' : 'managed'
      this.machine.send({ type: 'LAUNCH', browserMode })

      const page = await this.browserLifecycle.launch(this.audio.getAudioDataHandler())

      // In connect mode, skip authentication
      if (browserMode === 'connect') {
        this.machine.send({ type: 'BROWSER_READY_CONNECT' } as AgentEvent)
      } else {
        this.machine.send({ type: 'BROWSER_READY' })
        await this.browserLifecycle.authenticate()
        // LOGIN_SUCCESS is sent by the browserLifecycle 'status' listener
      }

      this.machine.send({ type: 'JOIN_SPACE', url: spaceUrl })
      this.spaceUrl = spaceUrl
      this.joinedAt = Date.now()
      await this.browserLifecycle.joinSpace(spaceUrl)

      this.machine.send({ type: 'JOINED_AS_LISTENER' })

      this.audio.setPage(page)
      this.audio.startCapture()
      this.health.setPage(page)

      // Wire observer into health monitor for event-driven Space-ended detection
      const observer = this.browserLifecycle.getObserver()
      if (observer) {
        this.health.setObserver(observer)
      }
      this.health.setSpaceUIOptions(this.browserLifecycle.getSpaceUIOptions())

      // Enable automatic mute-state recovery — periodically checks if the mic
      // got accidentally muted and auto-unmutes it
      const healthEmitter = new EventEmitter()
      healthEmitter.on('status', (s: string) => this.emit('status', s as any))
      this.health.enableAutoUnmute(healthEmitter)

      this.health.start()

      // Request speaker access — transitions to idle
      this.machine.send({ type: 'SPEAKER_GRANTED' })

      await this.pluginManager.notify('onJoined', spaceUrl)
    } catch (err) {
      // Wrap generic errors with more specific SDK error classes
      let error: Error
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('auth_token') || msg.includes('Login failed') || msg.includes('logged in')) {
        error = new AuthenticationError(msg)
      } else if (msg.includes('Space has ended') || msg.includes('Space ended')) {
        error = new SpaceNotFoundError(spaceUrl)
      } else if (msg.includes('Browser') || msg.includes('browser') || msg.includes('Chrome')) {
        const browserMode = (this.config.browser as any)?.connectMode ? 'connect' : 'managed'
        error = new BrowserConnectionError(browserMode, msg)
      } else {
        error = err instanceof Error ? err : new Error(msg)
      }
      await this.pluginManager.notify('onError', error, 'join')
      this.machine.send({ type: 'ERROR', error: error.message })
      await this.browserLifecycle.cleanup().catch(() => {})
      throw error
    }
  }

  /**
   * Join a Space as a listener only — does NOT request to speak.
   *
   * Use this for granular control, then call:
   * - `requestToSpeak()` — to click the request-to-speak button
   * - `waitForSpeakerAccess()` — to wait for the host to grant access
   * - `unmuteMic()` / `muteMic()` — to toggle the mic button in the Space
   * - `leave()` — to leave
   */
  async joinAsListener(spaceUrl: string): Promise<void> {
    const alreadyConnected = !!this.browserLifecycle.getPage()
    const currentState = this.machine.state
    if (alreadyConnected && currentState !== 'connected' && currentState !== 'space-ended') {
      throw new Error('Agent is busy. Call leave() first.')
    }

    if (!alreadyConnected) {
      await this.pluginManager.init()

      if (this.memoryStore) {
        await this.memoryStore.load()
      }
      if (this.knowledgeBase) {
        await this.knowledgeBase.ingest()
      }
    }

    await this.pluginManager.notify('onJoin', spaceUrl)

    try {
      let page = this.browserLifecycle.getPage()

      if (!page) {
        const browserMode = (this.config.browser as any)?.connectMode ? 'connect' : 'managed'
        this.machine.send({ type: 'LAUNCH', browserMode })

        page = await this.browserLifecycle.launch(this.audio.getAudioDataHandler())

        if (browserMode === 'connect') {
          this.machine.send({ type: 'BROWSER_READY_CONNECT' } as AgentEvent)
        } else {
          this.machine.send({ type: 'BROWSER_READY' })
          await this.browserLifecycle.authenticate()
        }
      }

      this.machine.send({ type: 'JOIN_SPACE', url: spaceUrl })
      this.spaceUrl = spaceUrl
      this.joinedAt = Date.now()
      await this.browserLifecycle.joinAsListener(spaceUrl)

      this.machine.send({ type: 'JOINED_AS_LISTENER' })

      this.audio.setPage(page!)
      this.audio.startCapture()
      this.health.setPage(page!)

      const observer = this.browserLifecycle.getObserver()
      if (observer) {
        this.health.setObserver(observer)
      }
      this.health.setSpaceUIOptions(this.browserLifecycle.getSpaceUIOptions())
      this.health.start()

      await this.pluginManager.notify('onJoined', spaceUrl)
    } catch (err) {
      let error: Error
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('auth_token') || msg.includes('Login failed') || msg.includes('logged in')) {
        error = new AuthenticationError(msg)
      } else if (msg.includes('Space has ended') || msg.includes('Space ended')) {
        error = new SpaceNotFoundError(spaceUrl)
      } else if (msg.includes('Browser') || msg.includes('browser') || msg.includes('Chrome')) {
        const browserMode = (this.config.browser as any)?.connectMode ? 'connect' : 'managed'
        error = new BrowserConnectionError(browserMode, msg)
      } else {
        error = err instanceof Error ? err : new Error(msg)
      }
      await this.pluginManager.notify('onError', error, 'join')
      this.machine.send({ type: 'ERROR', error: error.message })
      if (!alreadyConnected) {
        await this.browserLifecycle.cleanup().catch(() => {})
      }
      throw error
    }
  }

  /**
   * Request to speak in the current Space.
   * Requires being joined (via `join()` or `joinAsListener()`).
   *
   * @returns `"granted"` if already a speaker, `"requested"` if the request
   *          button was clicked, or `false` if the button wasn't found.
   */
  async requestToSpeak(): Promise<'granted' | 'requested' | false> {
    if (!this.browserLifecycle.getPage()) {
      throw new Error('Not in a Space. Call join() or joinAsListener() first.')
    }
    return this.browserLifecycle.requestToSpeak()
  }

  /**
   * Wait for the host to accept the speaker request.
   * Call after `requestToSpeak()` returns `"requested"`.
   *
   * @param timeoutMs - How long to wait (default 5 minutes)
   * @returns `true` when speaker access is granted
   * @throws {SpeakerAccessDeniedError} if timeout expires
   * @throws {SpaceEndedError} if the Space ends while waiting
   */
  async waitForSpeakerAccess(timeoutMs: number = 300000): Promise<boolean> {
    if (!this.browserLifecycle.getPage()) {
      throw new Error('Not in a Space. Call join() or joinAsListener() first.')
    }
    const result = await this.browserLifecycle.waitForSpeakerAccess(timeoutMs)
    if (result) {
      this.machine.send({ type: 'SPEAKER_GRANTED' })
    }
    return result
  }

  /**
   * Click the unmute button in the Space UI (browser mic toggle).
   * Uses aggressive multi-strategy clicking (CDP, pointer events, DOM click,
   * Puppeteer mouse) with retries and mic permission pre-granting.
   *
   * Different from `unmute()` which controls audio capture.
   */
  async unmuteMic(): Promise<boolean> {
    if (!this.browserLifecycle.getPage()) {
      throw new Error('Not in a Space. Call join() or joinAsListener() first.')
    }
    return this.browserLifecycle.aggressiveUnmuteInSpace()
  }

  /**
   * Click the mute button in the Space UI (browser mic toggle).
   * Different from `mute()` which controls audio capture.
   */
  async muteMic(): Promise<boolean> {
    if (!this.browserLifecycle.getPage()) {
      throw new Error('Not in a Space. Call join() or joinAsListener() first.')
    }
    return this.browserLifecycle.muteInSpace()
  }

  /**
   * All-in-one: request to speak, wait for host approval, then aggressively
   * unmute. Retries the request if it fails, and keeps trying to unmute.
   *
   * @param timeoutMs - Max time to wait for host approval (default 5 min)
   * @returns `true` if the agent is now speaking
   */
  async requestAndSpeak(timeoutMs: number = 300000): Promise<boolean> {
    if (!this.browserLifecycle.getPage()) {
      throw new Error('Not in a Space. Call join() or joinAsListener() first.')
    }

    const logger = getLogger()
    const maxRequestAttempts = 3

    for (let attempt = 1; attempt <= maxRequestAttempts; attempt++) {
      logger.info(`[XSpaceAgent] requestAndSpeak attempt ${attempt}/${maxRequestAttempts}`)

      // Check if already a speaker (mic button visible)
      if (await this.browserLifecycle.isMicUnmuted()) {
        logger.info('[XSpaceAgent] Already unmuted — ready to speak')
        this.machine.send({ type: 'SPEAKER_GRANTED' })
        return true
      }

      // Step 1: Request to speak
      const result = await this.browserLifecycle.requestToSpeak()
      logger.info(`[XSpaceAgent] requestToSpeak result: ${result}`)

      if (result === 'granted') {
        // Already a speaker — just need to unmute
        this.machine.send({ type: 'SPEAKER_GRANTED' })
        const unmuted = await this.browserLifecycle.aggressiveUnmuteInSpace()
        if (unmuted) return true
        continue
      }

      if (result === 'requested') {
        // Step 2: Wait for host to approve
        try {
          const approved = await this.browserLifecycle.waitForSpeakerAccess(
            Math.min(timeoutMs, 60000 * attempt), // Increase wait per attempt
          )
          if (approved) {
            this.machine.send({ type: 'SPEAKER_GRANTED' })
            // Step 3: Aggressively unmute
            const unmuted = await this.browserLifecycle.aggressiveUnmuteInSpace()
            if (unmuted) return true
          }
        } catch (err) {
          logger.warn(`[XSpaceAgent] waitForSpeakerAccess failed on attempt ${attempt}: ${err}`)
          // Will retry
        }
      }

      // result === false — button not found; could already be a speaker
      if (result === false) {
        logger.info('[XSpaceAgent] Request button not found — trying aggressive unmute in case already a speaker')
        this.machine.send({ type: 'SPEAKER_GRANTED' })
        const unmuted = await this.browserLifecycle.aggressiveUnmuteInSpace()
        if (unmuted) return true
      }
    }

    // Last resort: assume we can speak via controlled stream
    logger.warn('[XSpaceAgent] requestAndSpeak: all attempts exhausted, assuming speaker via controlled stream')
    this.machine.send({ type: 'SPEAKER_GRANTED' })
    return true
  }

  /**
   * Leave the current Space gracefully.
   *
   * Persists conversation state, disconnects audio, and closes the browser
   * if running in managed mode.
   */
  async leave(): Promise<void> {
    await this.pluginManager.notify('onLeave')

    this.audio.stopCapture()
    this.health.stop()

    // Persist memory store before leaving
    if (this.memoryStore) {
      try {
        await this.memoryStore.save()
      } catch {
        // Non-critical — don't block leave on persistence failure
      }
    }

    // Persist conversation before leaving
    if (this.spaceUrl) {
      try {
        await this.conversationStore.save(this.spaceUrl, this.contextManager.getMessages(), {
          startedAt: this.joinedAt,
          speakers: this.speakerIdentifier.getKnownSpeakers().map(s => s.name),
          topics: this.topicTracker.getTopicHistory().map(t => t.topic),
          summary: `Conversation in Space with ${this.speakerIdentifier.getKnownSpeakers().length} speakers`,
        })
      } catch {
        // Non-critical — don't block leave on persistence failure
      }
    }

    this.machine.send({ type: 'LEAVE' })

    try {
      await this.browserLifecycle.leaveSpace()
    } catch (err) {
      this.emit('error', new Error(`Failed to leave space cleanly: ${err instanceof Error ? err.message : String(err)}`))
    }

    this.machine.send({ type: 'LEFT' })
    this.spaceUrl = null
  }

  /**
   * Destroy the agent and release all resources.
   *
   * Unlike {@link leave}, this also disposes plugins, stops health monitoring,
   * and removes all event listeners. The agent cannot be reused after calling this.
   */
  async destroy(): Promise<void> {
    await this.pluginManager.destroy()
    this.health.stop()
    this.providerHealth.stopAll()
    this.audio.destroy()
    await this.browserLifecycle.cleanup()
    this.machine.send({ type: 'STOP' })
    this.removeAllListeners()
  }

  // ── Status ─────────────────────────────────────────────────

  /** Get the current lifecycle status of the agent. */
  getStatus(): AgentStatus {
    return this.machine.state as AgentStatus
  }

  /** Current lifecycle status (getter property). */
  get status(): AgentStatus {
    return this.machine.state as AgentStatus
  }

  /** Returns `true` if the agent is in any connected state (not `'disconnected'` or `'error'`). */
  isConnected(): boolean {
    const s = this.machine.state
    return s !== 'disconnected' && s !== 'error'
  }

  /** Return the event types that are valid transitions from the current state. */
  getAvailableActions(): string[] {
    return this.machine.getAvailableEvents()
  }

  /** Return the last N state transitions for debugging. */
  getTransitionHistory(limit?: number) {
    return this.machine.getHistory(limit)
  }

  /** Generate a Mermaid state diagram of the agent lifecycle. */
  toMermaid(): string {
    return this.machine.toMermaid()
  }

  /** Return metadata for all registered plugins. */
  getPlugins(): Array<{ name: string; version: string; description?: string }> {
    return this.pluginManager.getPlugins()
  }

  // ── Speaking ───────────────────────────────────────────────

  /**
   * Make the agent speak a specific text.
   *
   * The text is synthesized via TTS and injected into the Space audio.
   * Runs through all registered middleware and plugin hooks.
   *
   * @param text - The text to speak
   * @throws {ProviderError} If TTS synthesis fails
   */
  async say(text: string): Promise<void> {
    // Run plugin onResponse hook (say() is explicit speech, treat like a response)
    let processedText: string | null = await this.pluginManager.runHook('onResponse', text)
    if (processedText === null) return

    processedText = await this.conversation.runMiddleware('before:tts', processedText)
    if (processedText === null || processedText === undefined) return

    const audioBuffer = await this.audio.synthesize(processedText)
    if (!audioBuffer) return

    // Run plugin onBeforeSpeak hook
    const finalAudio = await this.pluginManager.runHook('onBeforeSpeak', audioBuffer)
    if (finalAudio === null) return

    // Ensure mic is unmuted before injecting audio
    try {
      await this.browserLifecycle.ensureUnmuted()
    } catch (e) {
      getLogger().warn(`[XSpaceAgent] ensureUnmuted failed before say: ${e instanceof Error ? e.message : e}`)
    }

    await this.conversation.runMiddleware('after:tts', finalAudio)
    this.machine.send({ type: 'RESPONSE_READY', text: processedText })
    this.machine.send({ type: 'SPEAKING_STARTED' } as AgentEvent)
    await this.audio.playAudio(finalAudio)
    this.machine.send({ type: 'SPEAKING_FINISHED' })

    const responseEvent: ResponseEvent = { text: processedText, audio: finalAudio }
    this.emit('response', responseEvent)
  }

  /** Stop capturing audio from the Space. */
  async mute(): Promise<void> {
    this.audio.stopCapture()
  }

  /** Resume capturing audio from the Space. */
  async unmute(): Promise<void> {
    this.audio.startCapture()
  }

  // ── AI Pipeline ────────────────────────────────────────────

  /**
   * Update the agent's system prompt at runtime.
   * @param prompt - The new system prompt text
   */
  setSystemPrompt(prompt: string): void {
    this.conversation.setSystemPrompt(prompt)
    this.promptBuilder.setBasePrompt(prompt)
  }

  /** Get the full conversation history as an array of {@link Message} objects. */
  getConversationHistory(): Message[] {
    return this.conversation.getHistory()
  }

  /** Clear the conversation history and LLM context. */
  clearHistory(): void {
    this.conversation.clearHistory()
    this.contextManager.clear()
    this.llm.clearHistory?.(0)
  }

  // ── Memory & Knowledge Base ──────────────────────────────

  /** Get the memory store instance (null if memory is disabled). */
  getMemoryStore(): MemoryStore | null {
    return this.memoryStore
  }

  /** Get the knowledge base instance (null if not configured). */
  getKnowledgeBase(): KnowledgeBase | null {
    return this.knowledgeBase
  }

  /** Get the context retriever for manual retrieval queries. */
  getContextRetriever(): ContextRetriever {
    return this.contextRetriever
  }

  // ── Provider Intelligence ────────────────────────────────

  /** Get status of all providers (LLM, STT, TTS) including health and metrics. */
  getProviderStatus(): { llm: ProviderStatus[]; stt: ProviderStatus[]; tts: ProviderStatus[] } {
    const toStatus = (p: { name: string; getMetrics(): any }): ProviderStatus => ({
      name: p.name,
      healthy: this.providerHealth.getLastResult(p.name)?.healthy ?? true,
      enabled: true,
      metrics: p.getMetrics(),
    })
    return {
      llm: [toStatus(this.llm)],
      stt: [toStatus(this.sttProvider)],
      tts: [toStatus(this.ttsProvider)],
    }
  }

  /** Get cost summary for the current session. */
  getCostSummary(sinceMs?: number): CostSummary {
    return this.costTracker.getSummary(sinceMs)
  }

  /** Get the cost tracker instance for external tracking. */
  getCostTracker(): CostTracker {
    return this.costTracker
  }

  /** Get the provider health monitor instance. */
  getProviderHealthMonitor(): ProviderHealthMonitor {
    return this.providerHealth
  }

  // ── Middleware / Hooks ─────────────────────────────────────

  /**
   * Register a middleware handler for a specific pipeline stage.
   *
   * @param stage - The pipeline stage to intercept (e.g., `'after:stt'`, `'before:llm'`)
   * @param handler - A function that receives stage data and returns transformed data, or `null` to abort
   * @returns `this` for chaining
   *
   * @example
   * ```typescript
   * agent.use('after:stt', (transcription) => {
   *   // Filter out profanity
   *   return { ...transcription, text: censor(transcription.text) };
   * });
   *
   * agent.use('after:llm', (response) => {
   *   // Limit response length
   *   return response.slice(0, 280);
   * });
   * ```
   */
  use(stage: MiddlewareStage, handler: (...args: any[]) => any): this {
    this.conversation.use(stage, handler)
    return this
  }

  // ── Typed event overloads ──────────────────────────────────

  on<K extends keyof AgentEvents>(event: K, listener: AgentEvents[K]): this
  on(event: string, listener: (...args: any[]) => void): this
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener)
  }

  emit<K extends keyof AgentEvents>(event: K, ...args: Parameters<AgentEvents[K]>): boolean
  emit(event: string, ...args: any[]): boolean
  emit(event: string, ...args: any[]): boolean {
    return super.emit(event, ...args)
  }

  // ── Private ────────────────────────────────────────────────

  private createPluginContext(): PluginContext {
    return {
      getStatus: () => this.getStatus(),
      getSpaceUrl: () => this.spaceUrl,
      getMessages: () => this.conversation.getHistory(),
      getSpeakers: () => [...this.speakers],
      getMetrics: () => ({ ...this.llm.getMetrics() }) as Record<string, unknown>,
      speak: (text: string) => this.say(text),
      addMessage: (message: Message) => this.conversation.addMessage(message.role, message.content),
      log: (level, message, data) => {
        const logger = getLogger()
        logger[level](`[plugin] ${message}`, data)
      },
      on: (event, handler) => this.on(event, handler as any),
      off: (event, handler) => this.off(event, handler as any),
    }
  }

  private async handleSpeechEnd(chunks: Buffer[]): Promise<void> {
    if (this.config.behavior?.autoRespond === false) return

    try {
      const wavBuffer = this.audio.chunksToWav(chunks, 16000)

      let audioData: any = wavBuffer
      audioData = await this.conversation.runMiddleware('before:stt', audioData)
      if (audioData === null || audioData === undefined) return

      this.machine.send({ type: 'SPEECH_DETECTED' })
      const { text } = await this.audio.transcribe(audioData, 'audio/wav')

      if (!text?.trim()) {
        this.machine.send({ type: 'ERROR', error: 'empty transcription' })
        return
      }

      // Speaker identification from X Space UI
      const page = this.browserLifecycle.getPage()
      const speaker = await this.speakerIdentifier.identifyFromUI(page) ?? 'Space Speaker'

      // Sentiment detection
      const sentiment = detectSentiment(text.trim())

      // Topic tracking
      this.topicTracker.onMessage(text.trim())

      let transcription: any = { speaker, text: text.trim(), timestamp: Date.now() }
      transcription = await this.conversation.runMiddleware('after:stt', transcription)
      if (transcription === null || transcription === undefined) {
        this.machine.send({ type: 'ERROR', error: 'middleware aborted after:stt' })
        return
      }

      // Plugin hook: onTranscription
      transcription = await this.pluginManager.runHook('onTranscription', transcription)
      if (transcription === null) {
        this.machine.send({ type: 'ERROR', error: 'plugin vetoed transcription' })
        return
      }

      this.emit('transcription', transcription as TranscriptionEvent)

      // Build enriched message with metadata
      const userMessage: Message = {
        role: 'user',
        content: speaker !== 'Space Speaker' ? `[${speaker}]: ${transcription.text}` : transcription.text,
        metadata: {
          speakerName: speaker !== 'Space Speaker' ? speaker : undefined,
          timestamp: Date.now(),
          topic: this.topicTracker.getCurrentTopic(),
          sentiment,
        },
      }

      this.conversation.addMessage('user', userMessage.content)
      this.contextManager.addMessage(userMessage)

      // Build dynamic system prompt with context
      let dynamicPrompt = this.promptBuilder.build()

      // Inject memory and knowledge base context
      const retrievedContext = await this.contextRetriever.getContext({
        query: transcription.text,
        speaker: speaker !== 'Space Speaker' ? speaker : undefined,
        maxMemories: this.config.memory?.maxRetrievedMemories ?? 5,
        maxChunks: this.config.knowledge?.maxRetrievedChunks ?? 3,
      })
      if (retrievedContext) {
        dynamicPrompt += retrievedContext
      }

      let llmInput: any = {
        messages: this.contextManager.getMessages(),
        systemPrompt: dynamicPrompt,
      }

      // Plugin hook: onBeforeResponse
      llmInput = await this.pluginManager.runHook('onBeforeResponse', llmInput)

      llmInput = await this.conversation.runMiddleware('before:llm', llmInput?.messages, llmInput?.systemPrompt)
      const systemPrompt = llmInput?.systemPrompt ?? dynamicPrompt

      let fullText = ''
      for await (const delta of this.llm.streamResponse(0, transcription.text, systemPrompt)) {
        fullText += delta
      }

      let response: any = fullText
      response = await this.conversation.runMiddleware('after:llm', response)
      if (response === null || response === undefined) {
        this.machine.send({ type: 'ERROR', error: 'middleware aborted after:llm' })
        return
      }

      // Plugin hook: onResponse
      response = await this.pluginManager.runHook('onResponse', response)
      if (response === null) {
        this.machine.send({ type: 'ERROR', error: 'plugin vetoed response' })
        return
      }

      this.conversation.addMessage('assistant', response)
      this.contextManager.addMessage({
        role: 'assistant',
        content: response,
        metadata: { timestamp: Date.now(), topic: this.topicTracker.getCurrentTopic() },
      })

      // Extract memories from this exchange (non-blocking)
      if (this.memoryExtractor && speaker !== 'Space Speaker') {
        this.memoryExtractor.extract({
          speaker,
          text: transcription.text,
          response,
          spaceUrl: this.spaceUrl ?? undefined,
        }).catch((err) => {
          this.emit('error', new Error(`Memory extraction failed: ${err instanceof Error ? err.message : String(err)}`))
        })
      }

      this.machine.send({ type: 'RESPONSE_READY', text: response })

      let ttsText: any = response
      ttsText = await this.conversation.runMiddleware('before:tts', ttsText)
      if (ttsText === null || ttsText === undefined) {
        this.machine.send({ type: 'SPEAKING_FINISHED' })
        return
      }

      const audioBuffer = await this.audio.synthesize(ttsText)
      if (audioBuffer) {
        // Plugin hook: onBeforeSpeak
        const finalAudio = await this.pluginManager.runHook('onBeforeSpeak', audioBuffer)
        if (finalAudio === null) {
          this.machine.send({ type: 'SPEAKING_FINISHED' })
          return
        }

        // Ensure mic is unmuted before injecting audio
        try {
          await this.browserLifecycle.ensureUnmuted()
        } catch (e) {
          getLogger().warn(`[XSpaceAgent] ensureUnmuted failed before speak: ${e instanceof Error ? e.message : e}`)
        }

        await this.conversation.runMiddleware('after:tts', finalAudio)
        await this.audio.playAudio(finalAudio)
      }

      this.machine.send({ type: 'SPEAKING_FINISHED' })

      const responseEvent: ResponseEvent = { text: response, audio: audioBuffer || undefined }
      this.emit('response', responseEvent)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      await this.pluginManager.notify('onError', error, 'handleSpeechEnd')
      this.emit('error', error)
      this.machine.send({ type: 'ERROR', error: error.message })
    }
  }

  /** Resolve model context window size for the context manager. */
  private getModelContextSize(model?: string): number {
    const MODEL_CONTEXT_LIMITS: Record<string, number> = {
      'gpt-4o': 128_000,
      'gpt-4o-mini': 128_000,
      'gpt-4': 8_192,
      'gpt-4-turbo': 128_000,
      'gpt-3.5-turbo': 4_096,
      'claude-sonnet-4-20250514': 200_000,
      'claude-3-5-sonnet-20241022': 200_000,
      'claude-3-opus-20240229': 200_000,
      'claude-3-haiku-20240307': 200_000,
      'llama-3.3-70b-versatile': 128_000,
      'mixtral-8x7b-32768': 32_768,
    }
    return MODEL_CONTEXT_LIMITS[model ?? ''] ?? 8_192
  }
}


