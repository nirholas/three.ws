// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

// =============================================================================
// Lightweight Finite State Machine Engine
// =============================================================================

/**
 * Callbacks in state/transition definitions receive the full event union.
 * Because the config is a `Record<string, …>` keyed by event type, TypeScript
 * cannot narrow the union automatically. We therefore type the event parameter
 * as `any` in the config-facing interfaces while keeping full type safety on
 * the `send()` / public API boundary.
 */

export interface TransitionDefinition<TContext, _TEvent extends { type: string }> {
  target: string
  guard?: (context: TContext, event: any) => boolean
  action?: (context: TContext, event: any) => void
}

export interface StateDefinition<TContext, TEvent extends { type: string }> {
  on?: Record<string, TransitionDefinition<TContext, TEvent>>
  entry?: (context: TContext) => void
  exit?: (context: TContext) => void
}

export interface MachineConfig<TContext, TEvent extends { type: string }> {
  id: string
  initial: string
  context: TContext
  states: Record<string, StateDefinition<TContext, TEvent>>
}

export interface TransitionRecord {
  from: string
  to: string
  event: string
  timestamp: number
}

type StateChangeListener<TContext> = (state: string, context: TContext) => void

export class StateMachine<TContext, TEvent extends { type: string }> {
  private currentState: string
  private config: MachineConfig<TContext, TEvent>
  private context: TContext
  private history: TransitionRecord[] = []
  private listeners: StateChangeListener<TContext>[] = []

  private static readonly MAX_HISTORY = 200

  constructor(config: MachineConfig<TContext, TEvent>) {
    this.config = config
    this.currentState = config.initial
    this.context = { ...config.context }

    // Validate initial state exists
    if (!config.states[config.initial]) {
      throw new Error(`Initial state "${config.initial}" is not defined in states`)
    }

    // Run entry action for the initial state
    const initialDef = config.states[config.initial]
    if (initialDef.entry) {
      initialDef.entry(this.context)
    }
  }

  /** Current state name */
  get state(): string {
    return this.currentState
  }

  /** Current context (shallow copy) */
  getContext(): TContext {
    return { ...this.context }
  }

  /**
   * Send an event to the machine, attempting a state transition.
   * Returns true if a transition occurred, false if rejected.
   */
  send(event: TEvent): boolean {
    const stateDef = this.config.states[this.currentState]
    if (!stateDef?.on) return false

    const transition = stateDef.on[event.type]
    if (!transition) return false

    // Check guard
    if (transition.guard && !transition.guard(this.context, event)) {
      return false
    }

    // Validate target state exists
    if (!this.config.states[transition.target]) {
      throw new Error(
        `Transition target "${transition.target}" from state "${this.currentState}" on event "${event.type}" is not defined`,
      )
    }

    const from = this.currentState

    // Exit action of current state
    if (stateDef.exit) {
      stateDef.exit(this.context)
    }

    // Transition action
    if (transition.action) {
      transition.action(this.context, event)
    }

    // Update state
    this.currentState = transition.target

    // Entry action of new state
    const targetDef = this.config.states[transition.target]
    if (targetDef.entry) {
      targetDef.entry(this.context)
    }

    // Record in history
    const record: TransitionRecord = {
      from,
      to: transition.target,
      event: event.type,
      timestamp: Date.now(),
    }
    this.history.push(record)
    if (this.history.length > StateMachine.MAX_HISTORY) {
      this.history = this.history.slice(-StateMachine.MAX_HISTORY)
    }

    // Notify listeners
    for (const listener of this.listeners) {
      listener(this.currentState, this.context)
    }

    return true
  }

  /**
   * Check if an event type can trigger a transition from the current state.
   * Evaluates guards using the current context and a minimal event object.
   */
  canSend(eventType: string): boolean {
    const stateDef = this.config.states[this.currentState]
    if (!stateDef?.on) return false

    const transition = stateDef.on[eventType]
    if (!transition) return false

    if (transition.guard) {
      // Create a minimal event with just the type for guard checking
      return transition.guard(this.context, { type: eventType } as TEvent)
    }

    return true
  }

  /** Return event types that have defined transitions from the current state. */
  getAvailableEvents(): string[] {
    const stateDef = this.config.states[this.currentState]
    if (!stateDef?.on) return []

    return Object.keys(stateDef.on).filter((eventType) => this.canSend(eventType))
  }

  /** Return recent transition history, optionally limited to the last N entries. */
  getHistory(limit?: number): TransitionRecord[] {
    if (limit !== undefined && limit >= 0) {
      return this.history.slice(-limit)
    }
    return [...this.history]
  }

  /**
   * Subscribe to state changes. Returns an unsubscribe function.
   */
  onChange(listener: StateChangeListener<TContext>): () => void {
    this.listeners.push(listener)
    return () => {
      const idx = this.listeners.indexOf(listener)
      if (idx !== -1) this.listeners.splice(idx, 1)
    }
  }

  /**
   * Generate a Mermaid state diagram from the machine config.
   */
  toMermaid(): string {
    let diagram = 'stateDiagram-v2\n'
    diagram += `  [*] --> ${this.config.initial}\n`

    for (const [stateName, stateDef] of Object.entries(this.config.states)) {
      if (!stateDef.on) continue
      for (const [event, transition] of Object.entries(stateDef.on)) {
        const guard = transition.guard ? ` [guarded]` : ''
        diagram += `  ${stateName} --> ${transition.target}: ${event}${guard}\n`
      }
    }

    return diagram
  }
}


