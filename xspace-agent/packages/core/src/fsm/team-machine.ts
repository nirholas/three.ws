// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

// =============================================================================
// Team Coordination State Machine
// =============================================================================

import { StateMachine } from './machine'
import type { MachineConfig } from './machine'

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type TeamEvent =
  | { type: 'START' }
  | { type: 'AGENT_READY'; agentId: string }
  | { type: 'ALL_AGENTS_READY' }
  | { type: 'TURN_REQUESTED'; agentId: string }
  | { type: 'TURN_GRANTED'; agentId: string }
  | { type: 'TURN_RELEASED'; agentId: string }
  | { type: 'AGENT_ERROR'; agentId: string; error: string }
  | { type: 'SPACE_ENDED' }
  | { type: 'STOP' }

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface TeamContext {
  readyAgents: Set<string>
  totalAgents: number
  currentSpeaker: string | null
  errorCount: number
  lastError: string | null
}

// ---------------------------------------------------------------------------
// State names
// ---------------------------------------------------------------------------

export const TEAM_STATES = [
  'idle',
  'initializing',
  'ready',
  'turn-active',
  'space-ended',
  'error',
  'stopped',
] as const

export type TeamState = (typeof TEAM_STATES)[number]

// ---------------------------------------------------------------------------
// Machine configuration
// ---------------------------------------------------------------------------

function createTeamMachineConfig(totalAgents: number): MachineConfig<TeamContext, TeamEvent> {
  return {
    id: 'team',
    initial: 'idle',
    context: {
      readyAgents: new Set<string>(),
      totalAgents,
      currentSpeaker: null,
      errorCount: 0,
      lastError: null,
    },
    states: {
      idle: {
        on: {
          START: {
            target: 'initializing',
          },
        },
      },

      initializing: {
        on: {
          AGENT_READY: {
            target: 'initializing',
            action(ctx, event) {
              ctx.readyAgents.add(event.agentId)
            },
          },
          ALL_AGENTS_READY: {
            target: 'ready',
            guard(ctx) {
              return ctx.readyAgents.size >= ctx.totalAgents
            },
          },
          AGENT_ERROR: {
            target: 'error',
            action(ctx, event) {
              ctx.lastError = `Agent ${event.agentId}: ${event.error}`
              ctx.errorCount++
            },
          },
          STOP: {
            target: 'stopped',
          },
        },
      },

      ready: {
        on: {
          TURN_REQUESTED: {
            target: 'turn-active',
            action(ctx, event) {
              ctx.currentSpeaker = event.agentId
            },
          },
          SPACE_ENDED: {
            target: 'space-ended',
          },
          AGENT_ERROR: {
            target: 'error',
            action(ctx, event) {
              ctx.lastError = `Agent ${event.agentId}: ${event.error}`
              ctx.errorCount++
            },
          },
          STOP: {
            target: 'stopped',
          },
        },
        entry(ctx) {
          ctx.currentSpeaker = null
        },
      },

      'turn-active': {
        on: {
          TURN_RELEASED: {
            target: 'ready',
            action(ctx) {
              ctx.currentSpeaker = null
            },
          },
          TURN_REQUESTED: {
            target: 'turn-active',
            action(ctx, event) {
              // Allow handoff: new agent takes the turn
              ctx.currentSpeaker = event.agentId
            },
          },
          SPACE_ENDED: {
            target: 'space-ended',
          },
          AGENT_ERROR: {
            target: 'ready',
            action(ctx, event) {
              ctx.lastError = `Agent ${event.agentId}: ${event.error}`
              ctx.errorCount++
              ctx.currentSpeaker = null
            },
          },
          STOP: {
            target: 'stopped',
          },
        },
      },

      'space-ended': {
        on: {
          STOP: {
            target: 'stopped',
          },
        },
      },

      error: {
        on: {
          START: {
            target: 'initializing',
            guard(ctx) {
              return ctx.errorCount < 5
            },
            action(ctx) {
              ctx.readyAgents.clear()
            },
          },
          STOP: {
            target: 'stopped',
          },
        },
      },

      stopped: {
        on: {
          START: {
            target: 'initializing',
            action(ctx) {
              ctx.readyAgents.clear()
              ctx.errorCount = 0
              ctx.lastError = null
              ctx.currentSpeaker = null
            },
          },
        },
      },
    },
  }
}

/**
 * Create a new team coordination state machine instance.
 */
export function createTeamMachine(totalAgents: number): StateMachine<TeamContext, TeamEvent> {
  return new StateMachine(createTeamMachineConfig(totalAgents))
}

/** Exported for testing */
export { createTeamMachineConfig }


