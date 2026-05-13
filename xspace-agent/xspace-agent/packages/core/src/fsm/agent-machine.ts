// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§68]

// =============================================================================
// Agent Lifecycle State Machine
// =============================================================================

import { StateMachine } from './machine'
import type { MachineConfig } from './machine'

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type AgentEvent =
  | { type: 'LAUNCH'; browserMode: 'managed' | 'connect' }
  | { type: 'BROWSER_READY' }
  | { type: 'BROWSER_READY_CONNECT' }
  | { type: 'LOGIN_SUCCESS' }
  | { type: 'LOGIN_FAILED'; error: string }
  | { type: 'JOIN_SPACE'; url: string }
  | { type: 'JOINED_AS_LISTENER' }
  | { type: 'SPEAKER_GRANTED' }
  | { type: 'SPEAKER_DENIED' }
  | { type: 'SPEECH_DETECTED'; speakerId?: string }
  | { type: 'SPEECH_ENDED' }
  | { type: 'RESPONSE_READY'; text: string }
  | { type: 'SPEAKING_STARTED' }
  | { type: 'SPEAKING_FINISHED' }
  | { type: 'SPACE_ENDED' }
  | { type: 'LEAVE' }
  | { type: 'LEFT' }
  | { type: 'STOP' }
  | { type: 'ERROR'; error: string }
  | { type: 'RECOVER' }
  | { type: 'BROWSER_DISCONNECTED' }
  | { type: 'RECONNECT' }

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface AgentContext {
  spaceUrl: string | null
  browserMode: 'managed' | 'connect' | null
  errorCount: number
  lastError: string | null
  joinedAt: number | null
  currentSpeaker: string | null
  /** The state to return to on RECOVER */
  lastSafeState: string | null
}

// ---------------------------------------------------------------------------
// Agent State Names (used to derive AgentStatus type)
// ---------------------------------------------------------------------------

export const AGENT_STATES = [
  'disconnected',
  'launching',
  'authenticating',
  'connected',
  'joining',
  'listening',
  'idle',
  'processing',
  'speaking',
  'leaving',
  'space-ended',
  'error',
] as const

export type AgentState = (typeof AGENT_STATES)[number]

// ---------------------------------------------------------------------------
// URL validation helper
// ---------------------------------------------------------------------------

const X_SPACE_URL_RE = /^https?:\/\/(x\.com|twitter\.com)\/i\/spaces\//i

function isValidSpaceUrl(url: string | undefined): boolean {
  return typeof url === 'string' && X_SPACE_URL_RE.test(url)
}

// ---------------------------------------------------------------------------
// Machine configuration
// ---------------------------------------------------------------------------

function createAgentMachineConfig(): MachineConfig<AgentContext, AgentEvent> {
  return {
    id: 'agent',
    initial: 'disconnected',
    context: {
      spaceUrl: null,
      browserMode: null,
      errorCount: 0,
      lastError: null,
      joinedAt: null,
      currentSpeaker: null,
      lastSafeState: null,
    },
    states: {
      // ── disconnected ─────────────────────────────────────────
      disconnected: {
        on: {
          LAUNCH: {
            target: 'launching',
            action(ctx, event) {
              ctx.browserMode = event.browserMode
            },
          },
        },
      },

      // ── launching ────────────────────────────────────────────
      launching: {
        on: {
          BROWSER_READY: {
            target: 'authenticating',
            guard(ctx) {
              return ctx.browserMode === 'managed'
            },
          },
          // In connect mode, skip authentication
          BROWSER_READY_CONNECT: {
            target: 'connected',
          },
          STOP: {
            target: 'disconnected',
          },
          ERROR: {
            target: 'error',
            action(ctx, event) {
              ctx.lastError = event.error
              ctx.lastSafeState = 'disconnected'
            },
          },
        },
        entry(_ctx) {
          // In managed mode BROWSER_READY → authenticating (guarded on browserMode === 'managed')
          // In connect mode BROWSER_READY_CONNECT → connected (no guard)
        },
      },

      // ── authenticating ───────────────────────────────────────
      authenticating: {
        on: {
          LOGIN_SUCCESS: {
            target: 'connected',
          },
          LOGIN_FAILED: {
            target: 'error',
            action(ctx, event) {
              ctx.lastError = event.error
              ctx.lastSafeState = 'disconnected'
            },
          },
          STOP: {
            target: 'disconnected',
          },
          ERROR: {
            target: 'error',
            action(ctx, event) {
              ctx.lastError = event.error
              ctx.lastSafeState = 'disconnected'
            },
          },
        },
      },

      // ── connected (logged in, no Space joined) ──────────────
      connected: {
        on: {
          JOIN_SPACE: {
            target: 'joining',
            guard(_ctx, event) {
              return isValidSpaceUrl(event.url)
            },
            action(ctx, event) {
              ctx.spaceUrl = event.url
            },
          },
          STOP: {
            target: 'disconnected',
          },
        },
        entry(ctx) {
          ctx.lastSafeState = 'connected'
        },
      },

      // ── joining ──────────────────────────────────────────────
      joining: {
        on: {
          JOINED_AS_LISTENER: {
            target: 'listening',
          },
          STOP: {
            target: 'disconnected',
          },
          ERROR: {
            target: 'error',
            action(ctx, event) {
              ctx.lastError = event.error
              ctx.lastSafeState = 'connected'
            },
          },
        },
      },

      // ── listening (in Space, hearing others) ─────────────────
      listening: {
        on: {
          SPEAKER_GRANTED: {
            target: 'idle',
          },
          SPEECH_DETECTED: {
            target: 'processing',
            action(ctx, event) {
              ctx.currentSpeaker = event.speakerId ?? null
            },
          },
          // Support explicit say() from listening state
          RESPONSE_READY: {
            target: 'speaking',
          },
          SPACE_ENDED: {
            target: 'space-ended',
          },
          LEAVE: {
            target: 'leaving',
          },
          STOP: {
            target: 'disconnected',
          },
          ERROR: {
            target: 'error',
            action(ctx, event) {
              ctx.lastError = event.error
              ctx.lastSafeState = 'connected'
            },
          },
        },
        entry(ctx) {
          ctx.joinedAt = ctx.joinedAt ?? Date.now()
          ctx.lastSafeState = 'connected'
        },
      },

      // ── idle (in Space as speaker, waiting) ──────────────────
      idle: {
        on: {
          SPEECH_DETECTED: {
            target: 'processing',
            action(ctx, event) {
              ctx.currentSpeaker = event.speakerId ?? null
            },
          },
          // Support explicit say() from idle state
          RESPONSE_READY: {
            target: 'speaking',
          },
          // Allow SPEAKER_GRANTED when already idle (e.g. periodic check confirms speaker status)
          SPEAKER_GRANTED: {
            target: 'idle',
          },
          SPACE_ENDED: {
            target: 'space-ended',
          },
          LEAVE: {
            target: 'leaving',
          },
          STOP: {
            target: 'disconnected',
          },
          ERROR: {
            target: 'error',
            action(ctx, event) {
              ctx.lastError = event.error
              ctx.lastSafeState = 'connected'
            },
          },
        },
        entry(ctx) {
          ctx.currentSpeaker = null
          ctx.lastSafeState = 'connected'
        },
      },

      // ── processing (transcribing + generating response) ──────
      processing: {
        on: {
          RESPONSE_READY: {
            target: 'speaking',
            action(ctx, event) {
              // event.text available for logging/context
            },
          },
          ERROR: {
            target: 'idle',
            action(ctx, event) {
              ctx.lastError = event.error
            },
          },
          SPACE_ENDED: {
            target: 'space-ended',
          },
          STOP: {
            target: 'disconnected',
          },
        },
      },

      // ── speaking (TTS playing into Space) ────────────────────
      speaking: {
        on: {
          SPEAKING_FINISHED: {
            target: 'idle',
          },
          SPACE_ENDED: {
            target: 'space-ended',
          },
          STOP: {
            target: 'disconnected',
          },
          ERROR: {
            target: 'idle',
            action(ctx, event) {
              ctx.lastError = event.error
            },
          },
        },
      },

      // ── leaving ──────────────────────────────────────────────
      leaving: {
        on: {
          LEFT: {
            target: 'connected',
          },
          STOP: {
            target: 'disconnected',
          },
          ERROR: {
            target: 'error',
            action(ctx, event) {
              ctx.lastError = event.error
              ctx.lastSafeState = 'disconnected'
            },
          },
        },
        exit(ctx) {
          ctx.spaceUrl = null
          ctx.joinedAt = null
          ctx.currentSpeaker = null
        },
      },

      // ── space-ended ──────────────────────────────────────────
      'space-ended': {
        on: {
          STOP: {
            target: 'disconnected',
          },
          JOIN_SPACE: {
            target: 'joining',
            guard(_ctx, event) {
              return isValidSpaceUrl(event.url)
            },
            action(ctx, event) {
              ctx.spaceUrl = event.url
            },
          },
        },
        entry(ctx) {
          ctx.currentSpeaker = null
        },
      },

      // ── error ────────────────────────────────────────────────
      error: {
        on: {
          RECOVER: {
            target: 'connected',
            guard(ctx) {
              // Prevent infinite recovery loops
              return ctx.errorCount < 5 && ctx.lastSafeState !== null
            },
            action(ctx) {
              // The target is overridden dynamically — but since our
              // machine doesn't support dynamic targets, we recover to
              // 'connected' which is the common safe state.
            },
          },
          STOP: {
            target: 'disconnected',
          },
          RECONNECT: {
            target: 'launching',
            guard(ctx) {
              return ctx.errorCount < 5
            },
          },
        },
        entry(ctx) {
          ctx.errorCount++
        },
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Fix: BROWSER_READY in connect mode needs to reach 'connected' directly.
// We handle this by checking browserMode inside the BROWSER_READY transition
// and providing two separate event names. The agent code will send the
// appropriate one based on mode.
// ---------------------------------------------------------------------------

/**
 * Create a new agent lifecycle state machine instance.
 */
export function createAgentMachine(): StateMachine<AgentContext, AgentEvent> {
  const config = createAgentMachineConfig()

  // For connect mode, we need BROWSER_READY to go to 'connected' instead of
  // 'authenticating'. We add the unguarded path as a separate event.
  // The launching state already has:
  //   BROWSER_READY → authenticating (guarded: managed mode only)
  //   BROWSER_READY_CONNECT → connected (no guard)
  // The agent code sends BROWSER_READY_CONNECT when in connect mode.

  return new StateMachine(config)
}

/** Exported for testing */
export { createAgentMachineConfig }


