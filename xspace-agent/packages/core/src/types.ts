// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§77]

// =============================================================================
// xspace-agent SDK — Public Types
// =============================================================================

// ---------------------------------------------------------------------------
// Configuration Types
// ---------------------------------------------------------------------------

/**
 * Top-level configuration for an {@link XSpaceAgent}.
 *
 * @example
 * ```typescript
 * const config: AgentConfig = {
 *   auth: { token: process.env.X_AUTH_TOKEN! },
 *   ai: {
 *     provider: 'openai',
 *     apiKey: process.env.OPENAI_API_KEY!,
 *     systemPrompt: 'You are a helpful assistant in an X Space.',
 *   },
 *   voice: { provider: 'openai', voiceId: 'nova' },
 *   browser: { headless: true },
 *   behavior: { autoRespond: true, silenceThreshold: 1.5 },
 * };
 * ```
 */
export interface AgentConfig {
  /** Authentication credentials for X/Twitter. */
  auth: AuthConfig;
  /** AI/LLM provider configuration. */
  ai: AIConfig;
  /** Text-to-speech configuration. */
  voice?: VoiceConfig;
  /** Browser launch and connection options. */
  browser?: BrowserConfig;
  /** Agent conversation behavior tuning. */
  behavior?: BehaviorConfig;
  /** Optional custom logger — defaults to console if not provided. */
  logger?: import('./logger').Logger;
  /** Plugins to extend the agent's behavior. */
  plugins?: import('./plugins/types').Plugin[];
  /** Long-term memory configuration — remembers facts across conversations. */
  memory?: import('./memory/types').MemoryConfig;
  /** RAG knowledge base configuration — grounds responses in user-provided documents. */
  knowledge?: import('./memory/types').KnowledgeConfig;
  /** Real-time translation configuration — enables multilingual conversations. */
  translation?: import('./translation/types').TranslationConfig;
}

/**
 * Authentication configuration for X/Twitter.
 *
 * Provide **either** a `token` (recommended) **or** `username` + `password`.
 * Token auth is more reliable and avoids CAPTCHA / 2FA issues.
 *
 * @example
 * ```typescript
 * // Token auth (recommended)
 * const auth: AuthConfig = { token: 'your_auth_token_cookie' };
 *
 * // Form login fallback
 * const auth: AuthConfig = {
 *   username: 'myhandle',
 *   password: 'secret',
 *   email: 'me@example.com',
 * };
 * ```
 */
export interface AuthConfig {
  /** X `auth_token` cookie value — get this from your browser's cookie inspector. */
  token?: string;
  /** X `ct0` CSRF token cookie — usually auto-generated, but can be provided. */
  ct0?: string;
  /** Username for form-based login. */
  username?: string;
  /** Password for form-based login. */
  password?: string;
  /** Email address used when X prompts for verification during login. */
  email?: string;
  /** Path to a JSON file where cookies are persisted between sessions. */
  cookiePath?: string;
}

/**
 * AI/LLM provider configuration.
 *
 * Supports OpenAI, Claude (Anthropic), Groq, and custom providers.
 *
 * @example
 * ```typescript
 * const ai: AIConfig = {
 *   provider: 'claude',
 *   model: 'claude-sonnet-4-20250514',
 *   apiKey: process.env.ANTHROPIC_API_KEY!,
 *   systemPrompt: 'You are a witty podcast host.',
 *   maxTokens: 300,
 * };
 * ```
 */
export interface AIConfig {
  /** LLM provider to use. */
  provider: 'openai' | 'claude' | 'groq' | 'custom';
  /** Model identifier (e.g. `'gpt-4o'`, `'claude-sonnet-4-20250514'`). Provider default used if omitted. */
  model?: string;
  /** API key for the chosen provider. */
  apiKey?: string;
  /** System prompt that defines the agent's personality and behavior. */
  systemPrompt: string;
  /** Maximum tokens in a single LLM response (default: 300). */
  maxTokens?: number;
  /** Sampling temperature — higher values produce more creative responses. */
  temperature?: number;
  /** Maximum number of conversation messages to keep in history */
  maxHistory?: number;
  /** Request timeout configuration */
  timeout?: {
    /** Milliseconds to wait for the stream to start (default: 30000) */
    streamStart?: number;
    /** Total milliseconds allowed for the entire request (default: 120000) */
    total?: number;
  };
  /** Response cache configuration */
  cache?: {
    /** Enable response caching for repeated queries (default: false) */
    enabled?: boolean;
    /** Maximum number of cached entries (default: 100) */
    maxSize?: number;
    /** Cache entry TTL in milliseconds (default: 300000) */
    ttlMs?: number;
  };
  /** Custom provider implementation — required when `provider` is `'custom'`. */
  custom?: CustomProvider;
}

/**
 * Text-to-speech provider configuration.
 *
 * @example
 * ```typescript
 * const voice: VoiceConfig = {
 *   provider: 'elevenlabs',
 *   apiKey: process.env.ELEVENLABS_API_KEY!,
 *   voiceId: 'VR6AewLTigWG4xSOukaG',
 *   stability: 0.7,
 * };
 * ```
 */
export interface VoiceConfig {
  /** TTS provider to use. `'browser'` delegates synthesis to the client. */
  provider: 'elevenlabs' | 'openai' | 'groq' | 'browser';
  /** API key for the TTS provider (not needed for `'browser'`). */
  apiKey?: string;
  /** Voice identifier — meaning depends on the provider. */
  voiceId?: string;
  /** Speech speed multiplier (default: 1.0). */
  speed?: number;
  /** ElevenLabs voice stability parameter (0–1, default: 0.5). */
  stability?: number;
  /** Fallback TTS providers tried in order if the primary fails. */
  fallback?: VoiceConfig[];
}

/**
 * Browser mode for connecting to Chrome.
 * - 'managed': Puppeteer launches and controls a headless Chrome instance (default).
 * - 'connect': Attach to an already-running Chrome via Chrome DevTools Protocol (no login needed).
 */
export type BrowserMode = 'managed' | 'connect';

/**
 * Browser launch and connection options.
 *
 * In **managed mode** (default), Puppeteer launches and controls a Chrome instance.
 * In **connect mode**, attach to an existing Chrome via CDP (no automated login needed).
 */
export interface BrowserConfig {
  /** Browser mode: 'managed' (default) or 'connect' via CDP. */
  mode?: BrowserMode;
  /** Run the browser in headless mode (default: true) — only used in 'managed' mode. */
  headless?: boolean;
  /** Custom path to a Chrome / Chromium executable — only used in 'managed' mode. */
  executablePath?: string;
  /** Directory used as the browser profile for cookie persistence — only used in 'managed' mode. */
  userDataDir?: string;
  /** HTTP/SOCKS proxy URL — only used in 'managed' mode. */
  proxy?: string;
  /** Extra Chromium command-line arguments — only used in 'managed' mode. */
  args?: string[];
  /** Full WebSocket URL for CDP connection (e.g. ws://localhost:9222/devtools/browser/...) — only used in 'connect' mode. Auto-discovered if omitted. */
  cdpEndpoint?: string;
  /** CDP host for endpoint discovery (default: 'localhost') — only used in 'connect' mode. */
  cdpHost?: string;
  /** CDP port for endpoint discovery (default: 9222) — only used in 'connect' mode. */
  cdpPort?: number;
}

/**
 * Tuning options for the agent's conversation behavior.
 *
 * @example
 * ```typescript
 * const behavior: BehaviorConfig = {
 *   autoRespond: true,
 *   silenceThreshold: 2.0,
 *   turnDelay: 1500,
 * };
 * ```
 */
export interface BehaviorConfig {
  /** Automatically respond to speakers (default: true). */
  autoRespond?: boolean;
  /** Seconds of silence before the recorder stops capturing (default: 1.5). */
  silenceThreshold?: number;
  /** Minimum speech duration (in seconds) required to process audio. */
  minSpeechDuration?: number;
  /** Maximum number of tokens in a single response. */
  maxResponseLength?: number;
  /** Whether the agent should respond to its own audio (default: false). */
  respondToSelf?: boolean;
  /** Delay in milliseconds between conversation turns (default: 1500). */
  turnDelay?: number;
}

// ---------------------------------------------------------------------------
// Agent Status (derived from FSM state names)
// ---------------------------------------------------------------------------

import type { AgentState } from './fsm/agent-machine'

/**
 * Current lifecycle state of an {@link XSpaceAgent}.
 *
 * Derived from the agent's internal finite state machine.
 * Subscribe to changes via `agent.on('status', ...)`.
 */
export type AgentStatus = AgentState

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

/** A single message in the conversation history. */
export interface Message {
  /** The speaker role: `'user'` for Space speakers, `'assistant'` for the agent, `'system'` for context. */
  role: 'user' | 'assistant' | 'system';
  /** The text content of the message. */
  content: string;
  /** Optional metadata about the message (speaker identity, sentiment, etc.). */
  metadata?: MessageMetadata;
}

/** Rich metadata attached to a {@link Message}. */
export interface MessageMetadata {
  /** Unique identifier for the speaker. */
  speakerId?: string;
  /** Display name of the speaker. */
  speakerName?: string;
  /** Unix timestamp (ms) when the message was recorded. */
  timestamp: number;
  /** Detected conversation topic. */
  topic?: string;
  /** Detected emotional tone of the message. */
  sentiment?: Sentiment;
  /** Estimated token count for the message. */
  tokens?: number;
  /** Whether this message was an interruption of another speaker. */
  isInterruption?: boolean;
  /** Transcription confidence score (0–1). */
  confidence?: number;
}

/** Detected emotional tone of a message. */
export type Sentiment = 'neutral' | 'positive' | 'negative' | 'question' | 'excited' | 'frustrated';

// ---------------------------------------------------------------------------
// Event Data Types
// ---------------------------------------------------------------------------

/** Emitted when speech is transcribed from the Space audio. */
export interface TranscriptionEvent {
  /** Display name of the speaker. */
  speaker: string;
  /** Transcribed text content. */
  text: string;
  /** Unix timestamp (ms) of the transcription. */
  timestamp: number;
}

/** Emitted when the agent generates and speaks a response. */
export interface ResponseEvent {
  /** The text that was spoken. */
  text: string;
  /** The synthesized audio buffer (MP3 or WAV), if TTS was used. */
  audio?: Buffer;
}

/** Emitted when a speaker joins or leaves the Space. */
export interface SpeakerEvent {
  /** X/Twitter username of the speaker. */
  username: string;
}

// ---------------------------------------------------------------------------
// Custom / Pluggable Provider Interfaces
// ---------------------------------------------------------------------------

/**
 * Interface for implementing a custom LLM provider.
 * Used when `AIConfig.provider` is set to `'custom'`.
 *
 * @example
 * ```typescript
 * const myProvider: CustomProvider = {
 *   type: 'socket',
 *   async generateResponse({ messages, systemPrompt }) {
 *     const response = await myLLM.complete(messages);
 *     return response.text;
 *   },
 *   async *generateResponseStream({ messages, systemPrompt }) {
 *     for await (const chunk of myLLM.stream(messages)) {
 *       yield chunk.text;
 *     }
 *   },
 * };
 * ```
 */
export interface CustomProvider {
  type: 'socket';
  /** Generate a complete response from the conversation history. */
  generateResponse(params: {
    messages: Message[];
    systemPrompt: string;
  }): Promise<string>;
  /** Optional streaming variant — yields response text incrementally. */
  generateResponseStream?(params: {
    messages: Message[];
    systemPrompt: string;
  }): AsyncIterable<string>;
}

// ---------------------------------------------------------------------------
// Internal Provider Interfaces
// ---------------------------------------------------------------------------

/** Cumulative performance metrics for a provider instance. */
export interface ProviderMetrics {
  /** Total number of requests made. */
  requestCount: number;
  /** Number of successful requests. */
  successCount: number;
  /** Number of failed requests. */
  errorCount: number;
  /** Total estimated input tokens across all requests. */
  totalInputTokens: number;
  /** Total estimated output tokens across all requests. */
  totalOutputTokens: number;
  /** Rolling average request latency in milliseconds. */
  avgLatencyMs: number;
  /** Rolling average time to first token in milliseconds. */
  avgTimeToFirstTokenMs: number;
}

/**
 * LLM provider interface used internally by the agent pipeline.
 * Supports streaming responses, health checks, and metrics.
 */
export interface LLMProvider {
  /** Human-readable provider name (e.g. `'claude'`, `'openai'`). */
  readonly name: string;
  /** Connection type. */
  type: 'socket' | 'webrtc';
  /**
   * Stream an LLM response for the given user text and system prompt.
   * @param agentId - The agent instance ID (for multi-agent history isolation).
   * @param userText - The user's input text.
   * @param systemPrompt - The system prompt to use.
   * @yields Text chunks as they are generated.
   */
  streamResponse(
    agentId: number,
    userText: string,
    systemPrompt: string,
  ): AsyncIterable<string>;
  /** Clear the conversation history for a specific agent. */
  clearHistory?(agentId: number): void;
  /** Check provider connectivity and latency. */
  checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  /** Get cumulative performance metrics. */
  getMetrics(): ProviderMetrics;
  /** Estimate cost in USD for the given token counts. */
  estimateCost(inputTokens: number, outputTokens?: number): number;
}

/**
 * Speech-to-text provider interface.
 * Transcribes audio buffers into text.
 */
export interface STTProvider {
  /** Human-readable provider name (e.g. `'openai-whisper'`, `'groq-whisper'`). */
  readonly name: string;
  /**
   * Transcribe an audio buffer to text.
   * @param audioBuffer - Raw audio data (WAV or WebM).
   * @param mimeType - MIME type of the audio (default: `'audio/webm'`).
   */
  transcribe(
    audioBuffer: Buffer,
    mimeType?: string,
  ): Promise<{ text: string }>;
  /** Check provider connectivity and latency. */
  checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  /** Get cumulative performance metrics. */
  getMetrics(): ProviderMetrics;
  /** Estimate cost in USD for the given audio duration in seconds. */
  estimateCost(durationSeconds: number): number;
}

/**
 * Text-to-speech provider interface.
 * Synthesizes text into audio buffers.
 */
export interface TTSProvider {
  /** Human-readable provider name (e.g. `'openai-tts'`, `'elevenlabs'`). */
  readonly name: string;
  /**
   * Synthesize text into an audio buffer.
   * @param text - The text to synthesize.
   * @param agentId - Optional agent ID for per-agent voice selection.
   * @returns Audio buffer (MP3), or `null` if browser-based TTS is used.
   */
  synthesize(text: string, agentId?: number): Promise<Buffer | null>;
  /** Optional streaming synthesis — returns audio chunks as they become available. */
  synthesizeStream?(text: string, agentId?: number): AsyncIterable<Buffer>;
  /** Check provider connectivity and latency. */
  checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  /** Get cumulative performance metrics. */
  getMetrics(): ProviderMetrics;
  /** Estimate cost in USD for the given character count. */
  estimateCost(characterCount: number): number;
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Stages in the audio processing pipeline where middleware can intercept data.
 *
 * - `before:stt` — Raw audio buffer before transcription
 * - `after:stt` — Transcription result before LLM processing
 * - `before:llm` — Messages and prompt before LLM call
 * - `after:llm` — Generated text before TTS
 * - `before:tts` — Text before synthesis
 * - `after:tts` — Synthesized audio buffer
 */
export type MiddlewareStage =
  | 'before:stt'
  | 'after:stt'
  | 'before:llm'
  | 'after:llm'
  | 'before:tts'
  | 'after:tts';

/** Input/output types for each middleware stage */
export interface MiddlewareDataMap {
  'before:stt': Buffer;
  'after:stt': TranscriptionEvent;
  'before:llm': { messages: Message[]; systemPrompt: string };
  'after:llm': string;
  'before:tts': string;
  'after:tts': Buffer;
}

/** A middleware handler receives the stage data and returns transformed data (or null to abort). */
export type MiddlewareHandler<S extends MiddlewareStage = MiddlewareStage> =
  (data: MiddlewareDataMap[S]) => MiddlewareDataMap[S] | null | undefined | Promise<MiddlewareDataMap[S] | null | undefined>;

// ---------------------------------------------------------------------------
// Multi-Agent / Team Types
// ---------------------------------------------------------------------------

/**
 * Configuration for an {@link AgentTeam} — multiple AI agents sharing one Space.
 *
 * @example
 * ```typescript
 * const teamConfig: AgentTeamConfig = {
 *   auth: { token: process.env.X_AUTH_TOKEN! },
 *   agents: [
 *     { name: 'Host', ai: { provider: 'openai', apiKey: '...', systemPrompt: '...' } },
 *     { name: 'Expert', ai: { provider: 'claude', apiKey: '...', systemPrompt: '...' } },
 *   ],
 *   turnManagement: { strategy: 'director' },
 * };
 * ```
 */
export interface AgentTeamConfig {
  /** Shared authentication for the browser session. */
  auth: AuthConfig;
  /** Individual agent configurations. Each agent has its own LLM and personality. */
  agents: TeamAgentConfig[];
  /** Shared browser configuration. */
  browser?: BrowserConfig;
  /** How turn-taking is managed between agents. */
  turnManagement?: TurnManagementConfig;
  /** AI config for the director strategy's LLM (uses first agent's AI config if omitted). */
  directorAI?: AIConfig;
  /** Maximum messages to include in director prompt context (default: 10). */
  directorContextWindow?: number;
}

/**
 * Configuration for a single agent within an {@link AgentTeam}.
 */
export interface TeamAgentConfig {
  /** Display name for this agent (used in logs, events, and director prompts). */
  name: string;
  /** LLM configuration for this agent. */
  ai: AIConfig;
  /** TTS configuration — gives each agent a distinct voice. */
  voice?: VoiceConfig;
  /** Higher priority agents are preferred when multiple match a topic (default: 0). */
  priority?: number;
  /** Topics this agent excels at — used by director strategy and interruption logic. */
  topics?: string[];
  /** Whether this agent can interrupt another agent's turn (default: false). */
  canInterrupt?: boolean;
  /** Minimum milliseconds between this agent's responses (default: 0). */
  cooldownMs?: number;
}

/**
 * Configuration for turn management in an {@link AgentTeam}.
 *
 * - `'queue'` — Least recently active idle agent responds next.
 * - `'round-robin'` — Agents take turns in a fixed cycle.
 * - `'director'` — An AI director selects the best agent for each turn.
 */
export interface TurnManagementConfig {
  /** Turn-taking strategy. */
  strategy: 'queue' | 'round-robin' | 'director';
  /** Delay in milliseconds between turns (default: 500). */
  turnDelay?: number;
}

// ---------------------------------------------------------------------------
// Team Event Data Types
// ---------------------------------------------------------------------------

/** Emitted when the team selects an agent to respond. */
export interface TeamAgentSelectedEvent {
  agentId: number;
  agentName: string;
  strategy: 'queue' | 'round-robin' | 'director';
  reason?: string;
}

/** Emitted when one agent hands off to another. */
export interface TeamHandoffEvent {
  from: { id: number; name: string };
  to: { id: number; name: string };
  context: string;
}

/** Emitted when one agent interrupts another. */
export interface TeamInterruptionEvent {
  by: { id: number; name: string };
  interrupted: { id: number; name: string };
  reason: string;
}

export interface TeamTurnCompleteEvent {
  agentId: number;
  agentName: string;
  durationMs: number;
  textLength: number;
}

export interface TeamEvents {
  agentSelected: (data: TeamAgentSelectedEvent) => void;
  handoff: (data: TeamHandoffEvent) => void;
  interruption: (data: TeamInterruptionEvent) => void;
  turnComplete: (data: TeamTurnCompleteEvent) => void;
  transcription: (data: TranscriptionEvent & { respondingAgent: { name: string; id: number } }) => void;
  response: (data: ResponseEvent) => void;
  error: (error: Error) => void;
  'space-ended': () => void;
}

// ---------------------------------------------------------------------------
// Turn Management Types
// ---------------------------------------------------------------------------

export type ResponseDecision =
  | { action: 'respond'; priority: number; reason: string }
  | { action: 'backchannel'; utterance: string }
  | { action: 'listen'; reason: string }
  | { action: 'defer'; toAgentId: string };

export type InterruptionAction = 'ignore' | 'pause' | 'yield';

export type ConversationPace = 'rapid' | 'normal' | 'slow';

export type Responsiveness = 'eager' | 'balanced' | 'reserved';

export interface DecisionInput {
  transcription: string;
  speaker: string | null;
  sentiment: Sentiment;
  topic: string;
  activeSpeakers: number;
  averageGapMs: number;
  recentMessages: Message[];
}

export interface ConversationSignals {
  directlyAddressed: boolean;
  isQuestion: boolean;
  topicRelevance: number;
  sentiment: Sentiment;
  speakerCount: number;
  conversationPace: number;
}

export interface TurnDecisionEvent {
  decision: ResponseDecision;
  transcription: string;
  speaker: string | null;
  timestamp: number;
}

export interface TurnInterruptedEvent {
  action: InterruptionAction;
  energy: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Typed EventEmitter Map
// ---------------------------------------------------------------------------

export interface AgentEvents {
  transcription: (data: TranscriptionEvent) => void;
  response: (data: ResponseEvent) => void;
  status: (status: AgentStatus) => void;
  error: (error: Error) => void;
  'speaker-joined': (data: SpeakerEvent) => void;
  'speaker-left': (data: SpeakerEvent) => void;
  'space-ended': () => void;
  'audio-chunk': (chunk: Float32Array) => void;
  'turn:decision': (data: TurnDecisionEvent) => void;
  'turn:interrupted': (data: TurnInterruptedEvent) => void;
  'turn:deferred': (toAgentId: string) => void;
  // Audio pipeline observability events
  'audio:level': (data: import('./audio/types').AudioLevels) => void;
  'audio:webrtc-stats': (data: import('./audio/types').WebRTCStats) => void;
  'audio:injection-start': (data: { durationMs: number }) => void;
  'audio:injection-end': () => void;
  'audio:echo-detected': (data: { energy: number }) => void;
  'audio:vad-speech': (data: { energy: number }) => void;
  'audio:vad-silence': (data: { durationMs: number }) => void;
  'audio:quality-degraded': (data: { reason: string; stats: import('./audio/types').WebRTCStats }) => void;
}


