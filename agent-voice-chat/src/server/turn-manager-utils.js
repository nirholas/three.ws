// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

'use strict'

const { TURN_DELAY_MS } = require('./constants')

/**
 * Factory that returns `requestTurn` and `releaseTurn` helpers bound to a
 * given state object.  Works for both room-scoped usage (server.js) and
 * single-state usage (socket-handler.js) by accepting the state and two
 * integration callbacks.
 *
 * @param {object}   state           - Object with `currentTurn`, `isProcessing`, and `turnQueue`.
 * @param {Function} callbacks.broadcast   - Called after any state mutation so the UI stays in sync.
 * @param {Function} callbacks.grantTurn   - Called with `agentId` when a turn is granted.
 * @returns {{ requestTurn: Function, releaseTurn: Function, isAgentTurn: Function }}
 */
function createTurnManager(state, { broadcast, grantTurn }) {
  function requestTurn(agentId) {
    if (state.currentTurn === null && !state.isProcessing) {
      state.currentTurn = agentId
      state.isProcessing = true
      grantTurn(agentId)
      broadcast()
      return true
    }
    if (!state.turnQueue.includes(agentId) && state.currentTurn !== agentId) {
      state.turnQueue.push(agentId)
      broadcast()
    }
    return false
  }

  function releaseTurn(agentId) {
    if (state.currentTurn === agentId) {
      state.currentTurn = null
      state.isProcessing = false
      if (state.turnQueue.length > 0) {
        const nextAgent = state.turnQueue.shift()
        setTimeout(() => {
          state.currentTurn = nextAgent
          state.isProcessing = true
          grantTurn(nextAgent)
          broadcast()
        }, TURN_DELAY_MS)
      } else {
        broadcast()
      }
    }
  }

  function isAgentTurn(agentId) {
    return state.currentTurn === agentId
  }

  return { requestTurn, releaseTurn, isAgentTurn }
}

module.exports = { createTurnManager }
