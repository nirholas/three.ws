// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§68]

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StateMachine } from '../fsm/machine'
import type { MachineConfig } from '../fsm/machine'
import { createAgentMachine, createAgentMachineConfig } from '../fsm/agent-machine'
import type { AgentEvent, AgentContext } from '../fsm/agent-machine'
import { createTeamMachine } from '../fsm/team-machine'
import type { TeamEvent } from '../fsm/team-machine'

// =============================================================================
// Generic StateMachine engine tests
// =============================================================================

describe('StateMachine', () => {
  // Simple traffic light machine for engine-level tests
  type TLEvent = { type: 'NEXT' } | { type: 'EMERGENCY' }
  interface TLContext { count: number }

  function trafficLightConfig(): MachineConfig<TLContext, TLEvent> {
    return {
      id: 'traffic-light',
      initial: 'green',
      context: { count: 0 },
      states: {
        green: {
          on: {
            NEXT: { target: 'yellow', action(ctx) { ctx.count++ } },
            EMERGENCY: { target: 'red' },
          },
        },
        yellow: {
          on: {
            NEXT: { target: 'red', action(ctx) { ctx.count++ } },
          },
        },
        red: {
          on: {
            NEXT: { target: 'green', action(ctx) { ctx.count++ } },
          },
          entry(ctx) { /* red entered */ },
        },
      },
    }
  }

  it('starts in the initial state', () => {
    const sm = new StateMachine(trafficLightConfig())
    expect(sm.state).toBe('green')
  })

  it('throws if initial state is not defined', () => {
    expect(() => {
      new StateMachine({
        id: 'bad',
        initial: 'nonexistent',
        context: {},
        states: { a: {} },
      })
    }).toThrow('Initial state "nonexistent" is not defined')
  })

  it('transitions on valid events', () => {
    const sm = new StateMachine(trafficLightConfig())
    expect(sm.send({ type: 'NEXT' })).toBe(true)
    expect(sm.state).toBe('yellow')
    expect(sm.send({ type: 'NEXT' })).toBe(true)
    expect(sm.state).toBe('red')
    expect(sm.send({ type: 'NEXT' })).toBe(true)
    expect(sm.state).toBe('green')
  })

  it('returns false for undefined events', () => {
    const sm = new StateMachine(trafficLightConfig())
    sm.send({ type: 'NEXT' }) // green → yellow
    // yellow has no EMERGENCY handler
    expect(sm.send({ type: 'EMERGENCY' } as TLEvent)).toBe(false)
    expect(sm.state).toBe('yellow')
  })

  it('runs action on transition', () => {
    const sm = new StateMachine(trafficLightConfig())
    sm.send({ type: 'NEXT' })
    sm.send({ type: 'NEXT' })
    sm.send({ type: 'NEXT' })
    expect(sm.getContext().count).toBe(3)
  })

  it('runs entry and exit actions', () => {
    const entrySpy = vi.fn()
    const exitSpy = vi.fn()
    const sm = new StateMachine<{ v: number }, { type: 'GO' }>({
      id: 'test',
      initial: 'a',
      context: { v: 0 },
      states: {
        a: {
          on: { GO: { target: 'b' } },
          exit: exitSpy,
        },
        b: {
          entry: entrySpy,
        },
      },
    })
    sm.send({ type: 'GO' })
    expect(exitSpy).toHaveBeenCalledOnce()
    expect(entrySpy).toHaveBeenCalledOnce()
  })

  it('runs entry action on initial state during construction', () => {
    const entrySpy = vi.fn()
    new StateMachine<{}, { type: 'X' }>({
      id: 'init-entry',
      initial: 'start',
      context: {},
      states: {
        start: { entry: entrySpy },
      },
    })
    expect(entrySpy).toHaveBeenCalledOnce()
  })

  describe('guards', () => {
    function guardedConfig(): MachineConfig<{ allowed: boolean }, { type: 'TRY' }> {
      return {
        id: 'guarded',
        initial: 'a',
        context: { allowed: false },
        states: {
          a: {
            on: {
              TRY: {
                target: 'b',
                guard: (ctx) => ctx.allowed,
              },
            },
          },
          b: {},
        },
      }
    }

    it('blocks transition when guard returns false', () => {
      const sm = new StateMachine(guardedConfig())
      expect(sm.send({ type: 'TRY' })).toBe(false)
      expect(sm.state).toBe('a')
    })

    it('allows transition when guard returns true', () => {
      const config = guardedConfig()
      config.context.allowed = true
      const sm = new StateMachine(config)
      expect(sm.send({ type: 'TRY' })).toBe(true)
      expect(sm.state).toBe('b')
    })
  })

  describe('history', () => {
    it('records transitions', () => {
      const sm = new StateMachine(trafficLightConfig())
      sm.send({ type: 'NEXT' })
      sm.send({ type: 'NEXT' })
      const history = sm.getHistory()
      expect(history).toHaveLength(2)
      expect(history[0]).toMatchObject({ from: 'green', to: 'yellow', event: 'NEXT' })
      expect(history[1]).toMatchObject({ from: 'yellow', to: 'red', event: 'NEXT' })
      expect(history[0].timestamp).toBeLessThanOrEqual(history[1].timestamp)
    })

    it('supports limit parameter', () => {
      const sm = new StateMachine(trafficLightConfig())
      sm.send({ type: 'NEXT' })
      sm.send({ type: 'NEXT' })
      sm.send({ type: 'NEXT' })
      const last2 = sm.getHistory(2)
      expect(last2).toHaveLength(2)
      expect(last2[0]).toMatchObject({ from: 'yellow', to: 'red' })
      expect(last2[1]).toMatchObject({ from: 'red', to: 'green' })
    })

    it('does not record failed transitions', () => {
      const sm = new StateMachine(trafficLightConfig())
      sm.send({ type: 'NEXT' }) // green → yellow
      sm.send({ type: 'EMERGENCY' } as TLEvent) // no handler on yellow → fails
      expect(sm.getHistory()).toHaveLength(1)
    })
  })

  describe('getAvailableEvents', () => {
    it('returns event types valid from current state', () => {
      const sm = new StateMachine(trafficLightConfig())
      expect(sm.getAvailableEvents()).toEqual(expect.arrayContaining(['NEXT', 'EMERGENCY']))

      sm.send({ type: 'NEXT' }) // yellow
      expect(sm.getAvailableEvents()).toEqual(['NEXT'])
    })

    it('excludes events blocked by guards', () => {
      const sm = new StateMachine<{ blocked: boolean }, { type: 'GO' }>({
        id: 'guard-avail',
        initial: 'a',
        context: { blocked: true },
        states: {
          a: {
            on: {
              GO: { target: 'b', guard: (ctx) => !ctx.blocked },
            },
          },
          b: {},
        },
      })
      expect(sm.getAvailableEvents()).toEqual([])
    })
  })

  describe('canSend', () => {
    it('returns true for valid events', () => {
      const sm = new StateMachine(trafficLightConfig())
      expect(sm.canSend('NEXT')).toBe(true)
    })

    it('returns false for invalid events', () => {
      const sm = new StateMachine(trafficLightConfig())
      expect(sm.canSend('UNKNOWN')).toBe(false)
    })

    it('checks guards', () => {
      const sm = new StateMachine<{ ok: boolean }, { type: 'GO' }>({
        id: 'cs',
        initial: 'a',
        context: { ok: false },
        states: {
          a: {
            on: { GO: { target: 'b', guard: (ctx) => ctx.ok } },
          },
          b: {},
        },
      })
      expect(sm.canSend('GO')).toBe(false)
    })
  })

  describe('onChange', () => {
    it('notifies listeners on transition', () => {
      const sm = new StateMachine(trafficLightConfig())
      const listener = vi.fn()
      sm.onChange(listener)

      sm.send({ type: 'NEXT' })
      expect(listener).toHaveBeenCalledWith('yellow', expect.objectContaining({ count: 1 }))
    })

    it('returns unsubscribe function', () => {
      const sm = new StateMachine(trafficLightConfig())
      const listener = vi.fn()
      const unsub = sm.onChange(listener)

      sm.send({ type: 'NEXT' })
      expect(listener).toHaveBeenCalledTimes(1)

      unsub()
      sm.send({ type: 'NEXT' })
      expect(listener).toHaveBeenCalledTimes(1) // not called again
    })

    it('does not notify on failed transitions', () => {
      const sm = new StateMachine(trafficLightConfig())
      const listener = vi.fn()
      sm.onChange(listener)

      sm.send({ type: 'NEXT' }) // green → yellow
      sm.send({ type: 'EMERGENCY' } as TLEvent) // fails
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  describe('toMermaid', () => {
    it('generates a valid Mermaid diagram', () => {
      const sm = new StateMachine(trafficLightConfig())
      const diagram = sm.toMermaid()
      expect(diagram).toContain('stateDiagram-v2')
      expect(diagram).toContain('[*] --> green')
      expect(diagram).toContain('green --> yellow: NEXT')
      expect(diagram).toContain('yellow --> red: NEXT')
      expect(diagram).toContain('red --> green: NEXT')
      expect(diagram).toContain('green --> red: EMERGENCY')
    })

    it('marks guarded transitions', () => {
      const sm = new StateMachine<{ x: boolean }, { type: 'GO' }>({
        id: 'g',
        initial: 'a',
        context: { x: true },
        states: {
          a: { on: { GO: { target: 'b', guard: () => true } } },
          b: {},
        },
      })
      const diagram = sm.toMermaid()
      expect(diagram).toContain('[guarded]')
    })
  })

  describe('getContext', () => {
    it('returns a copy of the context', () => {
      const sm = new StateMachine(trafficLightConfig())
      const ctx = sm.getContext()
      ctx.count = 999
      expect(sm.getContext().count).toBe(0) // original unchanged
    })
  })
})

// =============================================================================
// Agent State Machine tests
// =============================================================================

describe('Agent State Machine', () => {
  let machine: ReturnType<typeof createAgentMachine>

  beforeEach(() => {
    machine = createAgentMachine()
  })

  describe('happy path (managed mode)', () => {
    it('disconnected → launching → authenticating → connected → joining → listening → idle → speaking → idle', () => {
      expect(machine.state).toBe('disconnected')

      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      expect(machine.state).toBe('launching')

      machine.send({ type: 'BROWSER_READY' })
      expect(machine.state).toBe('authenticating')

      machine.send({ type: 'LOGIN_SUCCESS' })
      expect(machine.state).toBe('connected')

      machine.send({ type: 'JOIN_SPACE', url: 'https://x.com/i/spaces/1abc' })
      expect(machine.state).toBe('joining')

      machine.send({ type: 'JOINED_AS_LISTENER' })
      expect(machine.state).toBe('listening')

      machine.send({ type: 'SPEAKER_GRANTED' })
      expect(machine.state).toBe('idle')

      machine.send({ type: 'SPEECH_DETECTED', speakerId: 'user1' })
      expect(machine.state).toBe('processing')

      machine.send({ type: 'RESPONSE_READY', text: 'Hello!' })
      expect(machine.state).toBe('speaking')

      machine.send({ type: 'SPEAKING_FINISHED' })
      expect(machine.state).toBe('idle')
    })
  })

  describe('connect mode (skips authenticating)', () => {
    it('disconnected → launching → connected via BROWSER_READY_CONNECT', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'connect' })
      expect(machine.state).toBe('launching')

      // In connect mode, BROWSER_READY guard fails (browserMode !== managed)
      expect(machine.send({ type: 'BROWSER_READY' })).toBe(false)
      expect(machine.state).toBe('launching')

      // Use the connect-mode event
      machine.send({ type: 'BROWSER_READY_CONNECT' } as AgentEvent)
      expect(machine.state).toBe('connected')
    })
  })

  describe('invalid transitions are rejected', () => {
    it('cannot go from disconnected to speaking', () => {
      expect(machine.send({ type: 'SPEAKING_FINISHED' })).toBe(false)
      expect(machine.state).toBe('disconnected')
    })

    it('cannot go from disconnected to idle', () => {
      expect(machine.send({ type: 'SPEAKER_GRANTED' })).toBe(false)
      expect(machine.state).toBe('disconnected')
    })

    it('cannot join space from disconnected', () => {
      expect(machine.send({ type: 'JOIN_SPACE', url: 'https://x.com/i/spaces/1abc' })).toBe(false)
      expect(machine.state).toBe('disconnected')
    })

    it('cannot send BROWSER_READY from connected', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'BROWSER_READY' })
      machine.send({ type: 'LOGIN_SUCCESS' })
      expect(machine.state).toBe('connected')
      expect(machine.send({ type: 'BROWSER_READY' })).toBe(false)
    })
  })

  describe('guards', () => {
    it('JOIN_SPACE guard rejects invalid URLs', () => {
      // Get to connected state
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'BROWSER_READY' })
      machine.send({ type: 'LOGIN_SUCCESS' })
      expect(machine.state).toBe('connected')

      expect(machine.send({ type: 'JOIN_SPACE', url: 'not-a-url' })).toBe(false)
      expect(machine.state).toBe('connected')

      expect(machine.send({ type: 'JOIN_SPACE', url: 'https://google.com' })).toBe(false)
      expect(machine.state).toBe('connected')
    })

    it('JOIN_SPACE guard accepts valid X Space URLs', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'BROWSER_READY' })
      machine.send({ type: 'LOGIN_SUCCESS' })

      expect(machine.send({ type: 'JOIN_SPACE', url: 'https://x.com/i/spaces/1abc' })).toBe(true)
      expect(machine.state).toBe('joining')
    })

    it('JOIN_SPACE guard accepts twitter.com URLs', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'BROWSER_READY' })
      machine.send({ type: 'LOGIN_SUCCESS' })

      expect(machine.send({ type: 'JOIN_SPACE', url: 'https://twitter.com/i/spaces/1abc' })).toBe(true)
      expect(machine.state).toBe('joining')
    })

    it('RECOVER guard blocks after 5 errors', () => {
      // Get to error state with 5 errors
      for (let i = 0; i < 5; i++) {
        machine = createAgentMachine()
        machine.send({ type: 'LAUNCH', browserMode: 'managed' })
        machine.send({ type: 'ERROR', error: `error ${i}` })
        // For iteration tracking, we need to use a single machine instance
      }

      // Use single instance, trigger 5 errors
      machine = createAgentMachine()
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'ERROR', error: 'err1' }) // errorCount = 1
      expect(machine.state).toBe('error')
      machine.send({ type: 'RECONNECT' }) // back to launching, errorCount still 1
      machine.send({ type: 'ERROR', error: 'err2' }) // errorCount = 2
      machine.send({ type: 'RECONNECT' })
      machine.send({ type: 'ERROR', error: 'err3' }) // errorCount = 3
      machine.send({ type: 'RECONNECT' })
      machine.send({ type: 'ERROR', error: 'err4' }) // errorCount = 4
      machine.send({ type: 'RECONNECT' })
      machine.send({ type: 'ERROR', error: 'err5' }) // errorCount = 5
      expect(machine.state).toBe('error')

      // Now RECONNECT should be blocked (errorCount = 5, guard checks < 5)
      expect(machine.send({ type: 'RECONNECT' })).toBe(false)
      expect(machine.state).toBe('error')

      // STOP should still work
      expect(machine.send({ type: 'STOP' })).toBe(true)
      expect(machine.state).toBe('disconnected')
    })
  })

  describe('error recovery', () => {
    it('error → RECOVER → connected', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'BROWSER_READY' })
      machine.send({ type: 'LOGIN_SUCCESS' })
      expect(machine.state).toBe('connected')

      machine.send({ type: 'JOIN_SPACE', url: 'https://x.com/i/spaces/1abc' })
      machine.send({ type: 'ERROR', error: 'join failed' })
      expect(machine.state).toBe('error')
      expect(machine.getContext().lastError).toBe('join failed')

      machine.send({ type: 'RECOVER' })
      expect(machine.state).toBe('connected')
    })

    it('error → RECONNECT → launching', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'ERROR', error: 'browser crash' })
      expect(machine.state).toBe('error')

      machine.send({ type: 'RECONNECT' })
      expect(machine.state).toBe('launching')
    })

    it('error → STOP → disconnected', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'ERROR', error: 'fatal' })
      machine.send({ type: 'STOP' })
      expect(machine.state).toBe('disconnected')
    })

    it('processing error goes back to idle', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'BROWSER_READY' })
      machine.send({ type: 'LOGIN_SUCCESS' })
      machine.send({ type: 'JOIN_SPACE', url: 'https://x.com/i/spaces/1abc' })
      machine.send({ type: 'JOINED_AS_LISTENER' })
      machine.send({ type: 'SPEAKER_GRANTED' })
      machine.send({ type: 'SPEECH_DETECTED' })
      expect(machine.state).toBe('processing')

      machine.send({ type: 'ERROR', error: 'LLM timeout' })
      expect(machine.state).toBe('idle')
    })

    it('speaking error goes back to idle', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'BROWSER_READY' })
      machine.send({ type: 'LOGIN_SUCCESS' })
      machine.send({ type: 'JOIN_SPACE', url: 'https://x.com/i/spaces/1abc' })
      machine.send({ type: 'JOINED_AS_LISTENER' })
      machine.send({ type: 'SPEAKER_GRANTED' })
      machine.send({ type: 'SPEECH_DETECTED' })
      machine.send({ type: 'RESPONSE_READY', text: 'hi' })
      expect(machine.state).toBe('speaking')

      machine.send({ type: 'ERROR', error: 'TTS error' })
      expect(machine.state).toBe('idle')
    })
  })

  describe('error count tracking', () => {
    it('increments errorCount on entering error state', () => {
      expect(machine.getContext().errorCount).toBe(0)

      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'ERROR', error: 'boom' })
      expect(machine.getContext().errorCount).toBe(1)

      machine.send({ type: 'RECONNECT' })
      machine.send({ type: 'ERROR', error: 'boom again' })
      expect(machine.getContext().errorCount).toBe(2)
    })
  })

  describe('context updates', () => {
    it('sets browserMode on LAUNCH', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      expect(machine.getContext().browserMode).toBe('managed')
    })

    it('sets spaceUrl on JOIN_SPACE', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'BROWSER_READY' })
      machine.send({ type: 'LOGIN_SUCCESS' })
      machine.send({ type: 'JOIN_SPACE', url: 'https://x.com/i/spaces/1abc' })
      expect(machine.getContext().spaceUrl).toBe('https://x.com/i/spaces/1abc')
    })

    it('tracks currentSpeaker on SPEECH_DETECTED', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'BROWSER_READY' })
      machine.send({ type: 'LOGIN_SUCCESS' })
      machine.send({ type: 'JOIN_SPACE', url: 'https://x.com/i/spaces/1abc' })
      machine.send({ type: 'JOINED_AS_LISTENER' })
      machine.send({ type: 'SPEAKER_GRANTED' })
      machine.send({ type: 'SPEECH_DETECTED', speakerId: 'user42' })
      expect(machine.getContext().currentSpeaker).toBe('user42')
    })

    it('resets currentSpeaker on entering idle', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'BROWSER_READY' })
      machine.send({ type: 'LOGIN_SUCCESS' })
      machine.send({ type: 'JOIN_SPACE', url: 'https://x.com/i/spaces/1abc' })
      machine.send({ type: 'JOINED_AS_LISTENER' })
      machine.send({ type: 'SPEAKER_GRANTED' })
      expect(machine.getContext().currentSpeaker).toBe(null) // idle entry resets
    })

    it('clears spaceUrl on leaving exit', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'BROWSER_READY' })
      machine.send({ type: 'LOGIN_SUCCESS' })
      machine.send({ type: 'JOIN_SPACE', url: 'https://x.com/i/spaces/1abc' })
      machine.send({ type: 'JOINED_AS_LISTENER' })
      machine.send({ type: 'SPEAKER_GRANTED' })
      expect(machine.getContext().spaceUrl).toBe('https://x.com/i/spaces/1abc')

      machine.send({ type: 'LEAVE' })
      machine.send({ type: 'LEFT' })
      // leaving exit clears spaceUrl
      expect(machine.getContext().spaceUrl).toBe(null)
    })

    it('sets lastError on ERROR events', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'ERROR', error: 'test error message' })
      expect(machine.getContext().lastError).toBe('test error message')
    })
  })

  describe('transition history', () => {
    it('records all transitions in the happy path', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'BROWSER_READY' })
      machine.send({ type: 'LOGIN_SUCCESS' })
      machine.send({ type: 'JOIN_SPACE', url: 'https://x.com/i/spaces/1abc' })

      const history = machine.getHistory()
      expect(history).toHaveLength(4)
      expect(history.map((h) => `${h.from}->${h.to}`)).toEqual([
        'disconnected->launching',
        'launching->authenticating',
        'authenticating->connected',
        'connected->joining',
      ])
    })
  })

  describe('getAvailableEvents', () => {
    it('returns correct events per state', () => {
      expect(machine.getAvailableEvents()).toEqual(['LAUNCH'])

      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      expect(machine.getAvailableEvents()).toEqual(
        expect.arrayContaining(['BROWSER_READY', 'ERROR']),
      )

      machine.send({ type: 'BROWSER_READY' })
      machine.send({ type: 'LOGIN_SUCCESS' })
      // connected — JOIN_SPACE requires a valid URL via guard,
      // canSend checks with minimal event, so it may fail guard
      const events = machine.getAvailableEvents()
      expect(events).toContain('STOP')
    })
  })

  describe('space-ended state', () => {
    it('can rejoin a different space from space-ended', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'BROWSER_READY' })
      machine.send({ type: 'LOGIN_SUCCESS' })
      machine.send({ type: 'JOIN_SPACE', url: 'https://x.com/i/spaces/1abc' })
      machine.send({ type: 'JOINED_AS_LISTENER' })
      machine.send({ type: 'SPEAKER_GRANTED' })
      machine.send({ type: 'SPACE_ENDED' })
      expect(machine.state).toBe('space-ended')

      machine.send({ type: 'JOIN_SPACE', url: 'https://x.com/i/spaces/2def' })
      expect(machine.state).toBe('joining')
      expect(machine.getContext().spaceUrl).toBe('https://x.com/i/spaces/2def')
    })

    it('can stop from space-ended', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'BROWSER_READY' })
      machine.send({ type: 'LOGIN_SUCCESS' })
      machine.send({ type: 'JOIN_SPACE', url: 'https://x.com/i/spaces/1abc' })
      machine.send({ type: 'JOINED_AS_LISTENER' })
      machine.send({ type: 'SPACE_ENDED' })
      machine.send({ type: 'STOP' })
      expect(machine.state).toBe('disconnected')
    })
  })

  describe('leaving flow', () => {
    it('idle → leaving → connected', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'BROWSER_READY' })
      machine.send({ type: 'LOGIN_SUCCESS' })
      machine.send({ type: 'JOIN_SPACE', url: 'https://x.com/i/spaces/1abc' })
      machine.send({ type: 'JOINED_AS_LISTENER' })
      machine.send({ type: 'SPEAKER_GRANTED' })
      expect(machine.state).toBe('idle')

      machine.send({ type: 'LEAVE' })
      expect(machine.state).toBe('leaving')

      machine.send({ type: 'LEFT' })
      expect(machine.state).toBe('connected')
    })

    it('listening → leaving → connected', () => {
      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'BROWSER_READY' })
      machine.send({ type: 'LOGIN_SUCCESS' })
      machine.send({ type: 'JOIN_SPACE', url: 'https://x.com/i/spaces/1abc' })
      machine.send({ type: 'JOINED_AS_LISTENER' })
      expect(machine.state).toBe('listening')

      machine.send({ type: 'LEAVE' })
      expect(machine.state).toBe('leaving')

      machine.send({ type: 'LEFT' })
      expect(machine.state).toBe('connected')
    })
  })

  describe('onChange notifications', () => {
    it('fires for each agent state transition', () => {
      const listener = vi.fn()
      machine.onChange(listener)

      machine.send({ type: 'LAUNCH', browserMode: 'managed' })
      machine.send({ type: 'BROWSER_READY' })
      machine.send({ type: 'LOGIN_SUCCESS' })

      expect(listener).toHaveBeenCalledTimes(3)
      expect(listener).toHaveBeenNthCalledWith(1, 'launching', expect.any(Object))
      expect(listener).toHaveBeenNthCalledWith(2, 'authenticating', expect.any(Object))
      expect(listener).toHaveBeenNthCalledWith(3, 'connected', expect.any(Object))
    })
  })

  describe('Mermaid generation', () => {
    it('generates diagram with all agent states', () => {
      const diagram = machine.toMermaid()
      expect(diagram).toContain('stateDiagram-v2')
      expect(diagram).toContain('[*] --> disconnected')
      expect(diagram).toContain('disconnected --> launching: LAUNCH')
      expect(diagram).toContain('launching --> authenticating: BROWSER_READY')
      expect(diagram).toContain('authenticating --> connected: LOGIN_SUCCESS')
      expect(diagram).toContain('connected --> joining: JOIN_SPACE')
      expect(diagram).toContain('idle --> processing: SPEECH_DETECTED')
      expect(diagram).toContain('processing --> speaking: RESPONSE_READY')
      expect(diagram).toContain('speaking --> idle: SPEAKING_FINISHED')
      expect(diagram).toContain('error --> disconnected: STOP')
    })
  })
})

// =============================================================================
// Team State Machine tests
// =============================================================================

describe('Team State Machine', () => {
  let machine: ReturnType<typeof createTeamMachine>

  beforeEach(() => {
    machine = createTeamMachine(2)
  })

  it('starts in idle state', () => {
    expect(machine.state).toBe('idle')
  })

  describe('initialization flow', () => {
    it('idle → initializing → ready', () => {
      machine.send({ type: 'START' })
      expect(machine.state).toBe('initializing')

      machine.send({ type: 'AGENT_READY', agentId: '0' })
      machine.send({ type: 'AGENT_READY', agentId: '1' })
      machine.send({ type: 'ALL_AGENTS_READY' })
      expect(machine.state).toBe('ready')
    })

    it('ALL_AGENTS_READY guard requires all agents', () => {
      machine.send({ type: 'START' })
      machine.send({ type: 'AGENT_READY', agentId: '0' })
      // Only 1 of 2 agents ready
      expect(machine.send({ type: 'ALL_AGENTS_READY' })).toBe(false)
      expect(machine.state).toBe('initializing')
    })
  })

  describe('turn management', () => {
    function getToReady() {
      machine.send({ type: 'START' })
      machine.send({ type: 'AGENT_READY', agentId: '0' })
      machine.send({ type: 'AGENT_READY', agentId: '1' })
      machine.send({ type: 'ALL_AGENTS_READY' })
    }

    it('ready → turn-active → ready', () => {
      getToReady()
      machine.send({ type: 'TURN_REQUESTED', agentId: '0' })
      expect(machine.state).toBe('turn-active')
      expect(machine.getContext().currentSpeaker).toBe('0')

      machine.send({ type: 'TURN_RELEASED', agentId: '0' })
      expect(machine.state).toBe('ready')
      expect(machine.getContext().currentSpeaker).toBe(null)
    })

    it('supports handoff during turn-active', () => {
      getToReady()
      machine.send({ type: 'TURN_REQUESTED', agentId: '0' })
      expect(machine.getContext().currentSpeaker).toBe('0')

      machine.send({ type: 'TURN_REQUESTED', agentId: '1' })
      expect(machine.state).toBe('turn-active')
      expect(machine.getContext().currentSpeaker).toBe('1')
    })
  })

  describe('error handling', () => {
    it('agent error during initialization → error state', () => {
      machine.send({ type: 'START' })
      machine.send({ type: 'AGENT_ERROR', agentId: '0', error: 'init failed' })
      expect(machine.state).toBe('error')
      expect(machine.getContext().lastError).toContain('Agent 0')
    })

    it('agent error during turn → back to ready', () => {
      machine.send({ type: 'START' })
      machine.send({ type: 'AGENT_READY', agentId: '0' })
      machine.send({ type: 'AGENT_READY', agentId: '1' })
      machine.send({ type: 'ALL_AGENTS_READY' })
      machine.send({ type: 'TURN_REQUESTED', agentId: '0' })

      machine.send({ type: 'AGENT_ERROR', agentId: '0', error: 'LLM error' })
      expect(machine.state).toBe('ready')
      expect(machine.getContext().currentSpeaker).toBe(null)
    })

    it('error recovery via START (retry)', () => {
      machine.send({ type: 'START' })
      machine.send({ type: 'AGENT_ERROR', agentId: '0', error: 'fail' })
      expect(machine.state).toBe('error')

      machine.send({ type: 'START' })
      expect(machine.state).toBe('initializing')
    })

    it('error recovery blocked after 5 errors', () => {
      for (let i = 0; i < 5; i++) {
        machine.send({ type: 'START' })
        machine.send({ type: 'AGENT_ERROR', agentId: '0', error: `err ${i}` })
      }
      expect(machine.state).toBe('error')
      expect(machine.getContext().errorCount).toBe(5)

      expect(machine.send({ type: 'START' })).toBe(false)
      expect(machine.state).toBe('error')

      // STOP still works
      machine.send({ type: 'STOP' })
      expect(machine.state).toBe('stopped')
    })
  })

  describe('space ended', () => {
    it('ready → space-ended → stopped', () => {
      machine.send({ type: 'START' })
      machine.send({ type: 'AGENT_READY', agentId: '0' })
      machine.send({ type: 'AGENT_READY', agentId: '1' })
      machine.send({ type: 'ALL_AGENTS_READY' })

      machine.send({ type: 'SPACE_ENDED' })
      expect(machine.state).toBe('space-ended')

      machine.send({ type: 'STOP' })
      expect(machine.state).toBe('stopped')
    })

    it('turn-active → space-ended', () => {
      machine.send({ type: 'START' })
      machine.send({ type: 'AGENT_READY', agentId: '0' })
      machine.send({ type: 'AGENT_READY', agentId: '1' })
      machine.send({ type: 'ALL_AGENTS_READY' })
      machine.send({ type: 'TURN_REQUESTED', agentId: '0' })

      machine.send({ type: 'SPACE_ENDED' })
      expect(machine.state).toBe('space-ended')
    })
  })

  describe('stopped state', () => {
    it('can restart from stopped', () => {
      machine.send({ type: 'START' })
      machine.send({ type: 'AGENT_READY', agentId: '0' })
      machine.send({ type: 'AGENT_READY', agentId: '1' })
      machine.send({ type: 'ALL_AGENTS_READY' })
      machine.send({ type: 'STOP' })
      expect(machine.state).toBe('stopped')

      machine.send({ type: 'START' })
      expect(machine.state).toBe('initializing')
      // Context should be reset
      expect(machine.getContext().errorCount).toBe(0)
      expect(machine.getContext().readyAgents.size).toBe(0)
    })
  })
})


