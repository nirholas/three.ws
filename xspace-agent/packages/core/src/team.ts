// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§65]

import { EventEmitter } from 'events'
import type { Page } from 'puppeteer'
import type {
  AgentStatus,
  AuthConfig,
  AIConfig,
  VoiceConfig,
  BrowserConfig,
  Message,
  TranscriptionEvent,
  ResponseEvent,
  TeamAgentSelectedEvent,
  TeamHandoffEvent,
  TeamInterruptionEvent,
  TeamTurnCompleteEvent,
} from './types'
import type { LLMProvider, STTProvider, TTSProvider } from './pipeline/types'
import { BrowserManager } from './browser/launcher'
import { login } from './browser/auth'
import * as spaceUI from './browser/space-ui'
import { injectAudioHooks, injectAudio, pcmChunksToWav } from './audio/bridge'
import { VoiceActivityDetector } from './audio/vad'
import { createLLM } from './pipeline/llm'
import { createSTT, STTConfig } from './pipeline/stt'
import { createTTSWithFallback, TTSConfig } from './pipeline/tts'
import { createTeamMachine } from './fsm/team-machine'
import type { TeamEvent } from './fsm/team-machine'
import type { StateMachine } from './fsm/machine'
import type { TeamContext } from './fsm/team-machine'
import { TurnCoordinator } from './turns/coordinator'
import { DecisionEngine } from './turns/decision-engine'
import { AdaptiveSilenceDetector } from './turns/adaptive-silence'
import { ResponsePacer } from './turns/pacing'
import type { ResponseDecision } from './types'
import { AuthenticationError, SpaceNotFoundError, SpaceEndedError } from './errors'

// Re-export config types from types.ts (keep backward compat)
export type {
  TeamAgentConfig,
  TurnManagementConfig,
  AgentTeamConfig,
} from './types'

// Import the config types for internal use
import type {
  TeamAgentConfig,
  TurnManagementConfig,
  AgentTeamConfig,
} from './types'

// =============================================================================
// Internal Types
// =============================================================================

interface TeamAgent {
  id: number
  name: string
  llm: LLMProvider
  tts: TTSProvider
  history: Message[]
  status: AgentStatus
  priority: number
  topics: string[]
  canInterrupt: boolean
  cooldownMs: number
  lastSpokeAt: number
}

interface TeamTranscriptionEvent extends TranscriptionEvent {
  respondingAgent: { name: string; id: number }
}

/** Serializable snapshot of a team agent's state */
export interface TeamAgentSnapshot {
  id: number
  name: string
  history: Message[]
  status: AgentStatus
  priority: number
  topics: string[]
  metrics: { turnCount: number; totalDurationMs: number; avgDurationMs: number }
}

/** Serializable snapshot of the entire team */
export interface TeamSnapshot {
  agents: TeamAgentSnapshot[]
  conversationHistory: Array<{ agentId: number; agentName: string; role: string; content: string; timestamp: number }>
  config: { strategy: string; turnDelay: number; directorContextWindow: number }
}

// Handoff signal pattern: [HANDOFF:agentName] or [HANDOFF:agentName:reason]
const HANDOFF_PATTERN = /\[HANDOFF:([^\]:\s]+)(?::([^\]]*))?\]/i

// =============================================================================
// AgentTeam
// =============================================================================

/**
 * A team of multiple AI agents sharing a single X Space browser session.
 *
 * Each agent has its own LLM, personality, voice, and topic expertise.
 * The team coordinates turn-taking via one of three strategies:
 * `'queue'`, `'round-robin'`, or `'director'` (AI-driven selection).
 *
 * @example
 * ```typescript
 * const team = new AgentTeam({
 *   auth: { token: process.env.X_AUTH_TOKEN! },
 *   agents: [
 *     { name: 'Host', ai: { provider: 'openai', apiKey: '...', systemPrompt: '...' } },
 *     { name: 'Expert', ai: { provider: 'claude', apiKey: '...', systemPrompt: '...' } },
 *   ],
 *   turnManagement: { strategy: 'round-robin', turnDelay: 2000 },
 * });
 *
 * team.on('transcription', ({ text, respondingAgent }) => {
 *   console.log(`${respondingAgent.name} will respond to: ${text}`);
 * });
 *
 * await team.join('https://x.com/i/spaces/abc123');
 * ```
 */
export class AgentTeam extends EventEmitter {
  private config: AgentTeamConfig
  private browserManager: BrowserManager | null = null
  private page: Page | null = null
  private agents: TeamAgent[] = []
  private stt: STTProvider
  private directorLLM: LLMProvider | null = null
  private vad: VoiceActivityDetector
  private captureActive = false
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null
  private machine: StateMachine<TeamContext, TeamEvent>

  // Turn management
  private currentTurn: number | null = null
  private turnQueue: number[] = []
  private interruptionQueue: Array<{ agentId: number; reason: string }> = []
  private isProcessing = false
  private roundRobinIndex = 0

  // Speaker context / conversation log
  private conversationLog: Array<{
    agentId: number
    agentName: string
    role: string
    content: string
    timestamp: number
  }> = []

  // Per-agent performance metrics
  private agentMetrics: Map<number, { turnCount: number; totalDurationMs: number }> = new Map()

  // Smart turn management
  private turnCoordinator: TurnCoordinator
  private agentDecisionEngines: Map<number, DecisionEngine> = new Map()
  private silenceDetector: AdaptiveSilenceDetector
  private pacer: ResponsePacer

  constructor(config: AgentTeamConfig) {
    super()
    this.config = config

    // Create STT (shared across all agents)
    const firstAgent = config.agents[0]
    const sttConfig: STTConfig = {
      provider: firstAgent.ai.provider === 'openai' ? 'openai' : 'groq',
      apiKey: firstAgent.ai.apiKey || '',
    }
    this.stt = createSTT(sttConfig)

    // Create director LLM if director strategy is configured
    if (config.turnManagement?.strategy === 'director') {
      const directorAIConfig = config.directorAI || firstAgent.ai
      this.directorLLM = createLLM(directorAIConfig)
    }

    // Create agents
    this.agents = config.agents.map((agentConfig, index) => {
      const llm = createLLM(agentConfig.ai)
      const ttsConfig: TTSConfig = {
        provider: agentConfig.voice?.provider || 'openai',
        apiKey: agentConfig.voice?.apiKey || agentConfig.ai.apiKey,
        voiceId: agentConfig.voice?.voiceId,
        stability: agentConfig.voice?.stability,
        fallback: agentConfig.voice?.fallback?.map((fb) => ({
          provider: fb.provider,
          apiKey: fb.apiKey || agentConfig.ai.apiKey,
          voiceId: fb.voiceId,
          stability: fb.stability,
        })),
      }
      const tts = createTTSWithFallback(ttsConfig)

      return {
        id: index,
        name: agentConfig.name,
        llm,
        tts,
        history: [],
        status: 'disconnected' as AgentStatus,
        priority: agentConfig.priority ?? 0,
        topics: agentConfig.topics ?? [],
        canInterrupt: agentConfig.canInterrupt ?? false,
        cooldownMs: agentConfig.cooldownMs ?? 0,
        lastSpokeAt: 0,
      }
    })

    // Initialize team FSM
    this.machine = createTeamMachine(this.agents.length)

    // Initialize metrics
    for (const agent of this.agents) {
      this.agentMetrics.set(agent.id, { turnCount: 0, totalDurationMs: 0 })
    }

    // Create VAD
    this.vad = new VoiceActivityDetector({
      silenceThresholdMs: 1500,
      minChunks: 3,
    })

    this.vad.onSpeech((chunks: Buffer[]) => {
      this.handleSpeechEnd(chunks).catch((err: unknown) => {
        this.emit('error', err instanceof Error ? err : new Error(String(err)))
      })
    })

    // Smart turn management
    this.turnCoordinator = new TurnCoordinator()
    this.silenceDetector = new AdaptiveSilenceDetector()
    this.pacer = new ResponsePacer()

    // Wire adaptive silence into VAD
    this.vad.onGap((gapMs: number) => {
      this.silenceDetector.recordGap(gapMs)
      const newThreshold = this.silenceDetector.getThreshold()
      this.vad.setSilenceDuration(newThreshold)
      this.pacer.setPace(this.silenceDetector.getPace())
    })

    // Create per-agent decision engines
    for (const agent of this.agents) {
      const agentConfig = config.agents[agent.id]
      this.agentDecisionEngines.set(agent.id, new DecisionEngine({
        agentName: agent.name,
        responsiveness: 'balanced',
        topicKeywords: agent.topics,
      }))
    }
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Join an X Space with the full team.
   *
   * Launches a browser, authenticates, joins the Space, requests speaker access,
   * and begins listening for speech to route to the appropriate agent.
   *
   * @param spaceUrl - The URL of the X Space to join
   * @throws {SpaceNotFoundError} If the Space doesn't exist or has ended
   * @throws {AuthenticationError} If X authentication fails
   */
  async join(spaceUrl: string): Promise<void> {
    if (this.browserManager) {
      throw new Error('Team already running. Call destroy() first.')
    }

    this.machine.send({ type: 'START' })

    this.browserManager = new BrowserManager(this.config.browser)
    const { page } = await this.browserManager.launch()
    this.page = page

    await injectAudioHooks(page, (pcmBase64: string) => {
      if (!this.captureActive) return
      this.vad.feed(pcmBase64)
    }, this.config.browser?.mode)

    // Only login in managed mode — in connect mode, already logged in via Chrome
    if (!this.browserManager.isConnectMode) {
      const emitter = new EventEmitter()
      await login(page, this.config.auth, emitter)
    }

    const emitter = new EventEmitter()
    await spaceUI.joinSpace(page, spaceUrl, emitter)

    const speakerResult = await spaceUI.requestSpeaker(page, emitter)
    if (speakerResult === 'requested') {
      await spaceUI.waitForSpeakerAccess(page, emitter)
    } else {
      await spaceUI.unmute(page, emitter)
    }

    this.captureActive = true
    this.agents.forEach((a) => {
      a.status = 'idle'
      this.machine.send({ type: 'AGENT_READY', agentId: String(a.id) })
    })
    this.machine.send({ type: 'ALL_AGENTS_READY' })
    this.startHealthCheck()
  }

  /**
   * Destroy the team and release all resources.
   *
   * Leaves the Space, closes the browser, and removes all event listeners.
   * The team cannot be reused after calling this.
   */
  async destroy(): Promise<void> {
    this.captureActive = false
    this.stopHealthCheck()
    this.vad.destroy()

    if (this.page) {
      try {
        await spaceUI.leaveSpace(this.page, new EventEmitter())
      } catch {}
    }

    if (this.browserManager) {
      await this.browserManager.close()
      this.browserManager = null
      this.page = null
    }

    this.agents.forEach((a) => (a.status = 'disconnected'))
    this.machine.send({ type: 'STOP' })
    this.removeAllListeners()
  }

  /** Get the current team FSM state */
  getTeamState(): string {
    return this.machine.state
  }

  /** Return the event types valid from the current team state */
  getAvailableActions(): string[] {
    return this.machine.getAvailableEvents()
  }

  /** Return recent team FSM transitions for debugging */
  getTransitionHistory(limit?: number) {
    return this.machine.getHistory(limit)
  }

  /** Generate a Mermaid state diagram of the team FSM */
  toMermaid(): string {
    return this.machine.toMermaid()
  }

  /** Get a serializable snapshot of the team state */
  getSnapshot(): TeamSnapshot {
    return {
      agents: this.agents.map((a) => {
        const m = this.agentMetrics.get(a.id) || { turnCount: 0, totalDurationMs: 0 }
        return {
          id: a.id,
          name: a.name,
          history: [...a.history],
          status: a.status,
          priority: a.priority,
          topics: [...a.topics],
          metrics: {
            turnCount: m.turnCount,
            totalDurationMs: m.totalDurationMs,
            avgDurationMs: m.turnCount > 0 ? Math.round(m.totalDurationMs / m.turnCount) : 0,
          },
        }
      }),
      conversationHistory: [...this.conversationLog],
      config: {
        strategy: this.config.turnManagement?.strategy || 'queue',
        turnDelay: this.config.turnManagement?.turnDelay || 500,
        directorContextWindow: this.config.directorContextWindow || 10,
      },
    }
  }

  /** Restore team conversation history from a snapshot */
  restoreFromSnapshot(snapshot: TeamSnapshot): void {
    for (const agentSnap of snapshot.agents) {
      const agent = this.agents.find((a) => a.id === agentSnap.id)
      if (agent) {
        agent.history = [...agentSnap.history]
      }
      this.agentMetrics.set(agentSnap.id, {
        turnCount: agentSnap.metrics.turnCount,
        totalDurationMs: agentSnap.metrics.totalDurationMs,
      })
    }
    this.conversationLog = [...snapshot.conversationHistory]
  }

  /** Get the full conversation log with speaker identity */
  getConversationLog(): Array<{ agentId: number; agentName: string; role: string; content: string; timestamp: number }> {
    return [...this.conversationLog]
  }

  // ── Turn management ────────────────────────────────────────

  private async selectAgent(text: string): Promise<TeamAgent> {
    const strategy = this.config.turnManagement?.strategy || 'queue'

    // Check interruption queue first
    if (this.interruptionQueue.length > 0) {
      const interruption = this.interruptionQueue.shift()!
      const agent = this.agents.find((a) => a.id === interruption.agentId)
      if (agent && this.isAgentAvailable(agent)) {
        this.emit('agentSelected', {
          agentId: agent.id,
          agentName: agent.name,
          strategy,
          reason: `Interruption: ${interruption.reason}`,
        } satisfies TeamAgentSelectedEvent)
        return agent
      }
    }

    let selected: TeamAgent
    let reason: string

    switch (strategy) {
      case 'round-robin': {
        selected = this.selectByRoundRobin()
        reason = 'Round-robin rotation'
        break
      }
      case 'director': {
        const result = await this.selectByDirector(text)
        selected = result.agent
        reason = result.reason
        break
      }
      case 'queue':
      default: {
        selected = this.selectByQueue()
        reason = 'Queue: least recently active idle agent'
        break
      }
    }

    this.emit('agentSelected', {
      agentId: selected.id,
      agentName: selected.name,
      strategy,
      reason,
    } satisfies TeamAgentSelectedEvent)

    return selected
  }

  private selectByRoundRobin(): TeamAgent {
    // Skip agents on cooldown
    for (let i = 0; i < this.agents.length; i++) {
      const idx = (this.roundRobinIndex + i) % this.agents.length
      const agent = this.agents[idx]
      if (this.isAgentAvailable(agent)) {
        this.roundRobinIndex = idx + 1
        return agent
      }
    }
    // Fallback: just advance round-robin
    const agent = this.agents[this.roundRobinIndex % this.agents.length]
    this.roundRobinIndex++
    return agent
  }

  private selectByQueue(): TeamAgent {
    const idle = this.agents.filter((a) => this.isAgentAvailable(a))
    return idle.length > 0 ? idle[0] : this.agents[0]
  }

  private async selectByDirector(text: string): Promise<{ agent: TeamAgent; reason: string }> {
    if (!this.directorLLM) {
      return { agent: this.selectByRoundRobin(), reason: 'Director fallback: no director LLM configured' }
    }

    try {
      const prompt = this.buildDirectorPrompt(text)
      let fullResponse = ''
      for await (const delta of this.directorLLM.streamResponse(
        -1, // special agentId for director
        prompt,
        'You are a conversation director. Your job is to decide which agent should respond to the current message. Respond with ONLY the agent name on the first line, followed by a brief reason on the second line.'
      )) {
        fullResponse += delta
      }

      const parsed = this.parseDirectorResponse(fullResponse)
      if (parsed) {
        return { agent: parsed.agent, reason: `Director selected: ${parsed.reason}` }
      }

      return { agent: this.selectByRoundRobin(), reason: 'Director fallback: could not parse agent selection' }
    } catch (err: unknown) {
      this.emit('error', err instanceof Error ? err : new Error(`Director LLM error: ${String(err)}`))
      return { agent: this.selectByRoundRobin(), reason: 'Director fallback: LLM call failed' }
    }
  }

  private buildDirectorPrompt(currentText: string): string {
    const contextWindow = this.config.directorContextWindow || 10
    const recentMessages = this.conversationLog.slice(-contextWindow)

    const agentDescriptions = this.agents
      .map((a) => {
        const topics = a.topics.length > 0 ? ` (topics: ${a.topics.join(', ')})` : ''
        return `- ${a.name} [id:${a.id}, priority:${a.priority}]${topics}`
      })
      .join('\n')

    const conversationContext =
      recentMessages.length > 0
        ? recentMessages.map((m) => `[${m.agentName || 'User'}]: ${m.content}`).join('\n')
        : '(no prior conversation)'

    return `Available agents:\n${agentDescriptions}\n\nRecent conversation:\n${conversationContext}\n\nNew message from user: "${currentText}"\n\nWhich agent should respond? Reply with the agent name on the first line and a brief reason on the second line.`
  }

  private parseDirectorResponse(response: string): { agent: TeamAgent; reason: string } | null {
    const lines = response.trim().split('\n').filter((l) => l.trim())
    if (lines.length === 0) return null

    const agentName = lines[0].trim()
    const reason = lines.length > 1 ? lines.slice(1).join(' ').trim() : 'Director decision'

    // Try exact name match first, then case-insensitive, then partial
    let agent = this.agents.find((a) => a.name === agentName)
    if (!agent) {
      agent = this.agents.find((a) => a.name.toLowerCase() === agentName.toLowerCase())
    }
    if (!agent) {
      agent = this.agents.find((a) => agentName.toLowerCase().includes(a.name.toLowerCase()))
    }

    if (agent && this.isAgentAvailable(agent)) {
      return { agent, reason }
    }

    return null
  }

  private isAgentAvailable(agent: TeamAgent): boolean {
    const now = Date.now()
    if (agent.cooldownMs > 0 && now - agent.lastSpokeAt < agent.cooldownMs) {
      return false
    }
    return agent.status === 'idle' || agent.status === 'disconnected'
  }

  /** Check for interruption candidates based on message content */
  private checkForInterruptions(text: string, currentAgentId: number): void {
    const lowerText = text.toLowerCase()

    for (const agent of this.agents) {
      if (agent.id === currentAgentId) continue
      if (!agent.canInterrupt) continue
      if (!this.isAgentAvailable(agent)) continue

      // Check if any of the agent's topics appear in the text
      const matchedTopic = agent.topics.find((topic) => lowerText.includes(topic.toLowerCase()))
      if (matchedTopic) {
        // Only interrupt if this agent has higher priority
        const currentAgent = this.agents.find((a) => a.id === currentAgentId)
        if (currentAgent && agent.priority > currentAgent.priority) {
          this.interruptionQueue.push({
            agentId: agent.id,
            reason: `Topic match: "${matchedTopic}"`,
          })

          this.emit('interruption', {
            by: { id: agent.id, name: agent.name },
            interrupted: { id: currentAgent.id, name: currentAgent.name },
            reason: `Higher priority agent matched topic "${matchedTopic}"`,
          } satisfies TeamInterruptionEvent)
        }
      }
    }
  }

  /** Parse a handoff signal from an agent's response text */
  private parseHandoffSignal(text: string): { targetName: string; reason: string } | null {
    const match = text.match(HANDOFF_PATTERN)
    if (!match) return null
    return {
      targetName: match[1].trim(),
      reason: match[2]?.trim() || 'Agent requested handoff',
    }
  }

  /** Execute a handoff from one agent to another */
  private async executeHandoff(
    fromAgent: TeamAgent,
    targetName: string,
    reason: string,
    context: string,
  ): Promise<void> {
    const targetAgent =
      this.agents.find((a) => a.name.toLowerCase() === targetName.toLowerCase()) ||
      this.agents.find((a) => targetName.toLowerCase().includes(a.name.toLowerCase()))

    if (!targetAgent || targetAgent.id === fromAgent.id) return

    // Transfer recent conversation context to the target agent's history
    const handoffContext = `[Handoff from ${fromAgent.name}]: ${context}`
    targetAgent.history.push({ role: 'system', content: handoffContext })

    this.emit('handoff', {
      from: { id: fromAgent.id, name: fromAgent.name },
      to: { id: targetAgent.id, name: targetAgent.name },
      context: reason,
    } satisfies TeamHandoffEvent)

    // Queue the target agent for the next turn
    if (!this.turnQueue.includes(targetAgent.id)) {
      // Insert at front of queue for immediate pickup
      this.turnQueue.unshift(targetAgent.id)
    }
  }

  private requestTurn(agentId: number): boolean {
    if (this.currentTurn === null && !this.isProcessing) {
      this.currentTurn = agentId
      this.isProcessing = true
      this.machine.send({ type: 'TURN_REQUESTED', agentId: String(agentId) })
      return true
    }
    if (!this.turnQueue.includes(agentId) && this.currentTurn !== agentId) {
      this.turnQueue.push(agentId)
    }
    return false
  }

  private releaseTurn(agentId: number): void {
    if (this.currentTurn === agentId) {
      this.currentTurn = null
      this.isProcessing = false
      this.machine.send({ type: 'TURN_RELEASED', agentId: String(agentId) })

      if (this.turnQueue.length > 0) {
        const next = this.turnQueue.shift()!
        const delay = this.config.turnManagement?.turnDelay || 500
        setTimeout(() => {
          this.currentTurn = next
          this.isProcessing = true
          this.machine.send({ type: 'TURN_REQUESTED', agentId: String(next) })
        }, delay)
      }
    }
  }

  // ── Speaker context ─────────────────────────────────────────

  /** Build conversation messages with speaker identity for an agent */
  private buildSpeakerAwareHistory(agent: TeamAgent): Message[] {
    const teamInfo = this.agents
      .map((a) => {
        const topics = a.topics.length > 0 ? ` (expert in: ${a.topics.join(', ')})` : ''
        return `${a.name}${topics}`
      })
      .join(', ')

    const contextPreamble: Message = {
      role: 'system',
      content: `You are ${agent.name} in a team conversation with: ${teamInfo}. When you want to hand off to another agent, include [HANDOFF:AgentName:reason] in your response.`,
    }

    // Annotate history with speaker names from the conversation log
    const annotatedHistory: Message[] = agent.history.map((msg) => {
      if (msg.role === 'system') return msg

      // Find the matching conversation log entry for context
      const logEntry = this.conversationLog.find(
        (entry) => entry.content === msg.content && entry.role === msg.role
      )

      if (msg.role === 'user') {
        return { ...msg, content: `[Space Speaker]: ${msg.content}` }
      }
      if (msg.role === 'assistant' && logEntry) {
        return { ...msg, content: `[${logEntry.agentName}]: ${msg.content}` }
      }
      return msg
    })

    return [contextPreamble, ...annotatedHistory]
  }

  // ── Audio pipeline ─────────────────────────────────────────

  private async handleSpeechEnd(chunks: Buffer[]): Promise<void> {
    const wavBuffer = pcmChunksToWav(chunks, 16000)
    const { text } = await this.stt.transcribe(wavBuffer, 'audio/wav')
    if (!text?.trim()) return

    // Log user speech
    this.conversationLog.push({
      agentId: -1,
      agentName: 'Space Speaker',
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    })

    // ── Multi-agent decision coordination ─────────────────
    // Each agent's DecisionEngine decides independently, then the
    // TurnCoordinator resolves conflicts to pick the best responder.
    for (const agent of this.agents) {
      const engine = this.agentDecisionEngines.get(agent.id)
      if (!engine || !this.isAgentAvailable(agent)) continue

      const decision = engine.decide({
        transcription: text.trim(),
        speaker: null,
        sentiment: 'neutral',
        topic: '',
        activeSpeakers: 1,
        averageGapMs: this.silenceDetector.getThreshold(),
        recentMessages: agent.history.slice(-10),
      })

      this.turnCoordinator.submitDecision(String(agent.id), decision)
    }

    // Resolve: highest-priority agent wins
    const winnerId = this.turnCoordinator.resolveConflictsSync()

    // Fall back to existing strategy-based selection if no agent decided to respond
    const respondingAgent = winnerId !== null
      ? this.agents.find((a) => a.id === Number(winnerId)) ?? await this.selectAgent(text)
      : await this.selectAgent(text)

    // Check for interruption candidates
    this.checkForInterruptions(text, respondingAgent.id)

    const transcriptionEvent: TeamTranscriptionEvent = {
      speaker: 'Space Speaker',
      text: text.trim(),
      timestamp: Date.now(),
      respondingAgent: { name: respondingAgent.name, id: respondingAgent.id },
    }
    this.emit('transcription', transcriptionEvent)

    if (!this.requestTurn(respondingAgent.id)) return

    // Natural pacing delay
    await this.pacer.preResponseDelay()

    const turnStart = Date.now()
    respondingAgent.status = 'speaking'
    respondingAgent.history.push({ role: 'user', content: text.trim() })

    const maxHistory = this.config.agents[respondingAgent.id]?.ai.maxHistory || 20
    if (respondingAgent.history.length > maxHistory) {
      respondingAgent.history = respondingAgent.history.slice(-maxHistory)
    }

    try {
      let fullText = ''
      const systemPrompt = this.config.agents[respondingAgent.id].ai.systemPrompt

      // Build speaker-aware context
      const speakerHistory = this.buildSpeakerAwareHistory(respondingAgent)
      const contextPrefix = speakerHistory
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n')
      const enrichedPrompt = contextPrefix ? `${systemPrompt}\n\n${contextPrefix}` : systemPrompt

      for await (const delta of respondingAgent.llm.streamResponse(
        respondingAgent.id,
        text.trim(),
        enrichedPrompt
      )) {
        fullText += delta
      }

      respondingAgent.history.push({ role: 'assistant', content: fullText })
      respondingAgent.lastSpokeAt = Date.now()

      // Log agent response
      this.conversationLog.push({
        agentId: respondingAgent.id,
        agentName: respondingAgent.name,
        role: 'assistant',
        content: fullText,
        timestamp: Date.now(),
      })

      // Update metrics
      const durationMs = Date.now() - turnStart
      const metrics = this.agentMetrics.get(respondingAgent.id)!
      metrics.turnCount++
      metrics.totalDurationMs += durationMs

      // Emit turn complete
      this.emit('turnComplete', {
        agentId: respondingAgent.id,
        agentName: respondingAgent.name,
        durationMs,
        textLength: fullText.length,
      } satisfies TeamTurnCompleteEvent)

      // Check for handoff signals in the response
      const handoff = this.parseHandoffSignal(fullText)
      if (handoff) {
        await this.executeHandoff(respondingAgent, handoff.targetName, handoff.reason, fullText)
        // Strip the handoff signal from the spoken text
        fullText = fullText.replace(HANDOFF_PATTERN, '').trim()
      }

      const audioBuffer = await respondingAgent.tts.synthesize(fullText, respondingAgent.id)
      if (audioBuffer && this.page) {
        this.captureActive = false
        try {
          await injectAudio(this.page, audioBuffer)
        } finally {
          setTimeout(() => {
            this.captureActive = true
          }, 1500)
        }
      }

      // Record response in decision engine and coordinator
      const engine = this.agentDecisionEngines.get(respondingAgent.id)
      engine?.recordResponse()
      this.turnCoordinator.recordSpoke(String(respondingAgent.id))

      const responseEvent: ResponseEvent = {
        text: fullText,
        audio: audioBuffer || undefined,
      }
      this.emit('response', responseEvent)
    } catch (err: unknown) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      this.machine.send({ type: 'AGENT_ERROR', agentId: String(respondingAgent.id), error: String(err) })
    } finally {
      respondingAgent.status = 'idle'
      this.releaseTurn(respondingAgent.id)
    }
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      if (!this.page) {
        this.stopHealthCheck()
        return
      }

      try {
        const state = await spaceUI.getSpaceState(this.page)
        if (state.hasEnded) {
          this.captureActive = false
          this.machine.send({ type: 'SPACE_ENDED' })
          this.emit('space-ended')
          this.stopHealthCheck()
        }
      } catch {}
    }, 10000)
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
  }
}


