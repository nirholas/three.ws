// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

import { TurnManager } from "../../lib/turn-manager"

describe("TurnManager", () => {
  let tm
  let onBroadcast
  let onTurnGranted

  beforeEach(() => {
    vi.useFakeTimers()
    onBroadcast = vi.fn()
    onTurnGranted = vi.fn()
    tm = new TurnManager({ onBroadcast, onTurnGranted })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("requestTurn", () => {
    it("grants immediately when no one has turn", () => {
      const granted = tm.requestTurn(0)

      expect(granted).toBe(true)
      expect(tm.currentTurn).toBe(0)
      expect(tm.isProcessing).toBe(true)
      expect(onTurnGranted).toHaveBeenCalledWith(0)
      expect(onBroadcast).toHaveBeenCalledTimes(1)
    })

    it("queues when someone else has turn", () => {
      tm.requestTurn(0) // Agent 0 gets turn
      onBroadcast.mockClear()
      onTurnGranted.mockClear()

      const granted = tm.requestTurn(1) // Agent 1 should queue

      expect(granted).toBe(false)
      expect(tm.turnQueue).toEqual([1])
      expect(tm.currentTurn).toBe(0)
      expect(onTurnGranted).not.toHaveBeenCalled()
      expect(onBroadcast).toHaveBeenCalledTimes(1) // broadcasts queue update
    })

    it("does not duplicate already-queued agent", () => {
      tm.requestTurn(0) // Agent 0 gets turn
      tm.requestTurn(1) // Agent 1 queues
      tm.requestTurn(1) // Agent 1 tries again

      expect(tm.turnQueue).toEqual([1])
      expect(tm.turnQueue.length).toBe(1)
    })

    it("does not queue agent that already has turn", () => {
      tm.requestTurn(0)
      onBroadcast.mockClear()

      tm.requestTurn(0) // Same agent tries again

      expect(tm.turnQueue).toEqual([])
      expect(onBroadcast).not.toHaveBeenCalled()
    })

    it("queues multiple agents in order", () => {
      tm.requestTurn(0) // gets turn
      tm.requestTurn(1) // queues
      tm.requestTurn(2) // queues

      expect(tm.turnQueue).toEqual([1, 2])
    })
  })

  describe("releaseTurn", () => {
    it("grants to next in queue after delay", () => {
      tm.requestTurn(0)
      tm.requestTurn(1)
      onBroadcast.mockClear()
      onTurnGranted.mockClear()

      tm.releaseTurn(0)

      // Before timeout: turn is null, processing is false
      expect(tm.currentTurn).toBe(null)
      expect(tm.isProcessing).toBe(false)

      // After timeout: next agent gets turn
      vi.advanceTimersByTime(500)

      expect(tm.currentTurn).toBe(1)
      expect(tm.isProcessing).toBe(true)
      expect(onTurnGranted).toHaveBeenCalledWith(1)
      expect(tm.turnQueue).toEqual([])
    })

    it("sets currentTurn to null with empty queue", () => {
      tm.requestTurn(0)
      onBroadcast.mockClear()

      tm.releaseTurn(0)

      expect(tm.currentTurn).toBe(null)
      expect(tm.isProcessing).toBe(false)
      expect(onBroadcast).toHaveBeenCalledTimes(1)
    })

    it("does nothing for agent that does not have turn", () => {
      tm.requestTurn(0)
      onBroadcast.mockClear()
      onTurnGranted.mockClear()

      tm.releaseTurn(1) // Agent 1 doesn't have turn

      expect(tm.currentTurn).toBe(0)
      expect(tm.isProcessing).toBe(true)
      expect(onBroadcast).not.toHaveBeenCalled()
    })

    it("does nothing when no one has turn", () => {
      tm.releaseTurn(0)

      expect(tm.currentTurn).toBe(null)
      expect(onBroadcast).not.toHaveBeenCalled()
    })

    it("handles multiple agents releasing in sequence", () => {
      tm.requestTurn(0)
      tm.requestTurn(1)
      tm.requestTurn(2)

      // Release agent 0 -> agent 1 gets turn
      tm.releaseTurn(0)
      vi.advanceTimersByTime(500)
      expect(tm.currentTurn).toBe(1)
      expect(tm.turnQueue).toEqual([2])

      // Release agent 1 -> agent 2 gets turn
      tm.releaseTurn(1)
      vi.advanceTimersByTime(500)
      expect(tm.currentTurn).toBe(2)
      expect(tm.turnQueue).toEqual([])

      // Release agent 2 -> no one has turn
      tm.releaseTurn(2)
      expect(tm.currentTurn).toBe(null)
      expect(tm.isProcessing).toBe(false)
    })
  })

  describe("getState", () => {
    it("returns current state snapshot", () => {
      tm.requestTurn(0)
      tm.requestTurn(1)

      const state = tm.getState()

      expect(state).toEqual({
        currentTurn: 0,
        turnQueue: [1],
        isProcessing: true
      })
    })

    it("returns a copy of turnQueue (not a reference)", () => {
      tm.requestTurn(0)
      tm.requestTurn(1)

      const state = tm.getState()
      state.turnQueue.push(99)

      expect(tm.turnQueue).toEqual([1])
    })
  })

  describe("reset", () => {
    it("clears all state", () => {
      tm.requestTurn(0)
      tm.requestTurn(1)

      tm.reset()

      expect(tm.currentTurn).toBe(null)
      expect(tm.turnQueue).toEqual([])
      expect(tm.isProcessing).toBe(false)
    })
  })
})
