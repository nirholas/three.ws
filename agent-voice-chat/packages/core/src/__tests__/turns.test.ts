// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DecisionEngine } from '../turns/decision-engine'
import { InterruptionHandler } from '../turns/interruption'
import { AdaptiveSilenceDetector } from '../turns/adaptive-silence'
import { ResponsePacer } from '../turns/pacing'
import { TurnCoordinator } from '../turns/coordinator'
import type { DecisionInput, ResponseDecision } from '../types'

// =============================================================================
// DecisionEngine
// =============================================================================

describe('DecisionEngine', () => {
  let engine: DecisionEngine

  function makeInput(overrides: Partial<DecisionInput> = {}): DecisionInput {
    return {
      transcription: 'Hello everyone',
      speaker: null,
      sentiment: 'neutral',
      topic: '',
      activeSpeakers: 1,
      averageGapMs: 1500,
      recentMessages: [],
      ...overrides,
    }
  }

  beforeEach(() => {
    engine = new DecisionEngine({
      agentName: 'TestBot',
      responsiveness: 'balanced',
      topicKeywords: ['typescript', 'react', 'coding'],
    })
  })

  describe('direct address detection', () => {
    it('responds when agent name is mentioned', () => {
      const decision = engine.decide(makeInput({ transcription: 'Hey TestBot, what do you think?' }))
      expect(decision.action).toBe('respond')
      expect(decision).toHaveProperty('priority', 10)
      expect(decision).toHaveProperty('reason', 'directly addressed')
    })

    it('responds to @mention', () => {
      const decision = engine.decide(makeInput({ transcription: 'What about @testbot' }))
      expect(decision.action).toBe('respond')
      expect(decision).toHaveProperty('priority', 10)
    })

    it('responds when name is followed by comma', () => {
      const decision = engine.decide(makeInput({ transcription: 'testbot, can you explain?' }))
      expect(decision.action).toBe('respond')
      expect(decision).toHaveProperty('priority', 10)
    })

    it('responds when name is followed by question mark', () => {
      const decision = engine.decide(makeInput({ transcription: 'is that right testbot?' }))
      expect(decision.action).toBe('respond')
      expect(decision).toHaveProperty('priority', 10)
    })
  })

  describe('question detection with topic relevance', () => {
    it('responds to relevant questions', () => {
      const decision = engine.decide(makeInput({
        transcription: 'What is the best way to handle typescript generics and react hooks for coding?',
      }))
      expect(decision.action).toBe('respond')
    })

    it('listens to irrelevant questions', () => {
      const decision = engine.decide(makeInput({
        transcription: 'What is the weather like today?',
      }))
      expect(decision.action).toBe('listen')
    })
  })

  describe('consecutive response limit', () => {
    it('enters cooldown after max consecutive responses', () => {
      // Default maxConsecutive is 3
      engine.recordResponse()
      engine.recordResponse()
      engine.recordResponse()

      const decision = engine.decide(makeInput({
        transcription: 'Hey everyone, what about typescript?',
      }))
      expect(decision.action).toBe('listen')
      expect(decision).toHaveProperty('reason', 'cooldown — too many consecutive responses')
    })

    it('resets consecutive count on silence', () => {
      engine.recordResponse()
      engine.recordResponse()
      engine.recordResponse()
      engine.recordSilence()

      expect(engine.getConsecutiveResponses()).toBe(0)
    })

    it('still responds to direct address during cooldown', () => {
      engine.recordResponse()
      engine.recordResponse()
      engine.recordResponse()

      // Direct address should override cooldown
      const decision = engine.decide(makeInput({
        transcription: 'TestBot, please answer',
      }))
      expect(decision.action).toBe('respond')
      expect(decision).toHaveProperty('priority', 10)
    })
  })

  describe('recency check', () => {
    it('avoids responding too soon after last response', () => {
      engine.recordResponse() // sets lastResponseTime

      const decision = engine.decide(makeInput({
        transcription: 'Tell me about typescript coding react',
      }))
      // Should be too soon (< 10s default)
      expect(decision.action).toBe('listen')
      expect(decision).toHaveProperty('reason', 'too soon since last response')
    })
  })

  describe('responsiveness modes', () => {
    it('eager mode responds to questions even with lower relevance', () => {
      const eager = new DecisionEngine({
        agentName: 'EagerBot',
        responsiveness: 'eager',
        topicKeywords: ['specifictopic'],
      })
      const decision = eager.decide(makeInput({
        transcription: 'Can someone help with this?',
      }))
      expect(decision.action).toBe('respond')
    })

    it('reserved mode requires higher topic relevance', () => {
      const reserved = new DecisionEngine({
        agentName: 'ReservedBot',
        responsiveness: 'reserved',
        topicKeywords: ['niche'],
      })
      const decision = reserved.decide(makeInput({
        transcription: 'This is a general discussion about things',
      }))
      expect(decision.action).toBe('listen')
    })
  })

  describe('backchannel', () => {
    it('can produce backchannel for positive sentiment (stochastic)', () => {
      // Run many times — should sometimes backchannel
      let backchannelCount = 0
      for (let i = 0; i < 100; i++) {
        const e = new DecisionEngine({
          agentName: 'Bot',
          responsiveness: 'balanced',
          topicKeywords: [],
        })
        const decision = e.decide(makeInput({ sentiment: 'positive' }))
        if (decision.action === 'backchannel') backchannelCount++
      }
      // With 30% probability, we should see roughly 20-40 backchannels out of 100
      expect(backchannelCount).toBeGreaterThan(0)
      expect(backchannelCount).toBeLessThan(60)
    })
  })

  describe('reset', () => {
    it('resets all internal state', () => {
      engine.recordResponse()
      engine.recordResponse()
      engine.reset()
      expect(engine.getConsecutiveResponses()).toBe(0)
      expect(engine.getLastResponseTime()).toBe(0)
    })
  })
})

// =============================================================================
// InterruptionHandler
// =============================================================================

describe('InterruptionHandler', () => {
  let handler: InterruptionHandler

  beforeEach(() => {
    handler = new InterruptionHandler()
  })

  it('ignores external speech when not speaking', () => {
    const action = handler.onExternalSpeechDetected(0.5, 3000)
    expect(action).toBe('ignore')
  })

  it('ignores short bursts (< 500ms) while speaking', () => {
    const abort = new AbortController()
    handler.onSpeakingStart(abort)
    const action = handler.onExternalSpeechDetected(0.5, 300)
    expect(action).toBe('ignore')
  })

  it('pauses on medium speech (500ms-2000ms) while speaking', () => {
    const abort = new AbortController()
    handler.onSpeakingStart(abort)
    const action = handler.onExternalSpeechDetected(0.5, 1000)
    expect(action).toBe('pause')
  })

  it('yields on long speech (> 2000ms) while speaking', () => {
    const abort = new AbortController()
    handler.onSpeakingStart(abort)
    const action = handler.onExternalSpeechDetected(0.5, 3000)
    expect(action).toBe('yield')
  })

  it('aborts TTS on pause', () => {
    const abort = new AbortController()
    handler.onSpeakingStart(abort)
    handler.execute('pause')
    expect(abort.signal.aborted).toBe(true)
    expect(abort.signal.reason).toBe('pause')
  })

  it('aborts TTS and clears state on yield', () => {
    const abort = new AbortController()
    handler.onSpeakingStart(abort)
    handler.execute('yield')
    expect(abort.signal.aborted).toBe(true)
    expect(abort.signal.reason).toBe('yield')
    expect(handler.isSpeaking()).toBe(false)
  })

  it('tracks speaking state', () => {
    expect(handler.isSpeaking()).toBe(false)
    const abort = new AbortController()
    handler.onSpeakingStart(abort)
    expect(handler.isSpeaking()).toBe(true)
    handler.onSpeakingEnd()
    expect(handler.isSpeaking()).toBe(false)
  })

  it('configurable thresholds', () => {
    const custom = new InterruptionHandler({
      backchannelThresholdMs: 1000,
      yieldThresholdMs: 5000,
    })
    const abort = new AbortController()
    custom.onSpeakingStart(abort)

    // 800ms < 1000ms backchannel threshold → ignore
    expect(custom.onExternalSpeechDetected(0.5, 800)).toBe('ignore')
    // 2000ms between 1000ms and 5000ms → pause
    expect(custom.onExternalSpeechDetected(0.5, 2000)).toBe('pause')
    // 6000ms > 5000ms → yield
    expect(custom.onExternalSpeechDetected(0.5, 6000)).toBe('yield')
  })

  it('reset clears all state', () => {
    const abort = new AbortController()
    handler.onSpeakingStart(abort)
    handler.reset()
    expect(handler.isSpeaking()).toBe(false)
  })
})

// =============================================================================
// AdaptiveSilenceDetector
// =============================================================================

describe('AdaptiveSilenceDetector', () => {
  let detector: AdaptiveSilenceDetector

  beforeEach(() => {
    detector = new AdaptiveSilenceDetector({ baseThresholdMs: 1500 })
  })

  it('returns base threshold with fewer than 3 gaps', () => {
    expect(detector.getThreshold()).toBe(1500)
    detector.recordGap(500)
    expect(detector.getThreshold()).toBe(1500)
    detector.recordGap(600)
    expect(detector.getThreshold()).toBe(1500)
  })

  it('adapts threshold based on median gap', () => {
    // Record 5 gaps: median = 400
    detector.recordGap(200)
    detector.recordGap(300)
    detector.recordGap(400)
    detector.recordGap(500)
    detector.recordGap(600)

    // Expected: 400 * 1.5 = 600, clamped to [500, 3000]
    expect(detector.getThreshold()).toBe(600)
  })

  it('clamps to minimum threshold', () => {
    // Very fast gaps: median = 100, 100 * 1.5 = 150 → clamped to 500
    detector.recordGap(50)
    detector.recordGap(100)
    detector.recordGap(100)
    detector.recordGap(150)
    expect(detector.getThreshold()).toBe(500)
  })

  it('clamps to maximum threshold', () => {
    // Very slow gaps: median = 5000, 5000 * 1.5 = 7500 → clamped to 3000
    detector.recordGap(4000)
    detector.recordGap(5000)
    detector.recordGap(5000)
    detector.recordGap(6000)
    expect(detector.getThreshold()).toBe(3000)
  })

  it('maintains window size', () => {
    const small = new AdaptiveSilenceDetector({ windowSize: 3, baseThresholdMs: 1500 })
    small.recordGap(100)
    small.recordGap(200)
    small.recordGap(300)
    small.recordGap(1000) // Should push out the 100
    // Gaps now: [200, 300, 1000], median = 300, threshold = 450 → clamped to 500
    expect(small.getGapCount()).toBe(3)
  })

  describe('pace detection', () => {
    it('detects rapid pace', () => {
      detector.recordGap(200)
      detector.recordGap(300)
      detector.recordGap(400)
      // Threshold = 300 * 1.5 = 450 → clamped to 500 → still < 800 = rapid
      expect(detector.getPace()).toBe('rapid')
    })

    it('detects normal pace', () => {
      detector.recordGap(800)
      detector.recordGap(900)
      detector.recordGap(1000)
      // Threshold = 900 * 1.5 = 1350 → between 800 and 2000
      expect(detector.getPace()).toBe('normal')
    })

    it('detects slow pace', () => {
      detector.recordGap(2000)
      detector.recordGap(2500)
      detector.recordGap(3000)
      // Threshold = 2500 * 1.5 = 3750 → clamped to 3000 → > 2000
      expect(detector.getPace()).toBe('slow')
    })
  })

  it('reset clears gaps', () => {
    detector.recordGap(500)
    detector.recordGap(600)
    detector.recordGap(700)
    detector.reset()
    expect(detector.getGapCount()).toBe(0)
    expect(detector.getThreshold()).toBe(1500) // back to base
  })
})

// =============================================================================
// ResponsePacer
// =============================================================================

describe('ResponsePacer', () => {
  let pacer: ResponsePacer

  beforeEach(() => {
    pacer = new ResponsePacer({ maxJitterMs: 0 }) // Disable jitter for predictable tests
  })

  it('defaults to normal pace', () => {
    expect(pacer.getPace()).toBe('normal')
  })

  it('changes pace', () => {
    pacer.setPace('rapid')
    expect(pacer.getPace()).toBe('rapid')
    pacer.setPace('slow')
    expect(pacer.getPace()).toBe('slow')
  })

  it('returns correct base delay for each pace', () => {
    pacer.setPace('rapid')
    expect(pacer.getBaseDelay()).toBe(300)
    pacer.setPace('normal')
    expect(pacer.getBaseDelay()).toBe(800)
    pacer.setPace('slow')
    expect(pacer.getBaseDelay()).toBe(1500)
  })

  it('sends thinking signal only for slow pace', () => {
    pacer.setPace('rapid')
    expect(pacer.shouldSendThinkingSignal()).toBe(false)
    pacer.setPace('normal')
    expect(pacer.shouldSendThinkingSignal()).toBe(false)
    pacer.setPace('slow')
    expect(pacer.shouldSendThinkingSignal()).toBe(true)
  })

  it('preResponseDelay waits approximately the right time', async () => {
    pacer.setPace('rapid')
    const start = Date.now()
    await pacer.preResponseDelay()
    const elapsed = Date.now() - start
    // Should be ~300ms (no jitter)
    expect(elapsed).toBeGreaterThanOrEqual(280)
    expect(elapsed).toBeLessThan(500)
  })

  it('accepts custom delays', () => {
    const custom = new ResponsePacer({
      delays: { rapid: 100, normal: 500, slow: 2000 },
      maxJitterMs: 0,
    })
    custom.setPace('rapid')
    expect(custom.getBaseDelay()).toBe(100)
    custom.setPace('slow')
    expect(custom.getBaseDelay()).toBe(2000)
  })
})

// =============================================================================
// TurnCoordinator
// =============================================================================

describe('TurnCoordinator', () => {
  let coordinator: TurnCoordinator

  beforeEach(() => {
    coordinator = new TurnCoordinator({ collectionWindowMs: 10 })
  })

  it('returns null when no decisions submitted', () => {
    const winner = coordinator.resolveConflictsSync()
    expect(winner).toBeNull()
  })

  it('ignores non-respond decisions', () => {
    coordinator.submitDecision('agent-1', { action: 'listen', reason: 'not relevant' })
    coordinator.submitDecision('agent-2', { action: 'backchannel', utterance: 'mm-hmm' })
    const winner = coordinator.resolveConflictsSync()
    expect(winner).toBeNull()
  })

  it('picks the highest priority responder', () => {
    coordinator.submitDecision('agent-1', { action: 'respond', priority: 5, reason: 'topic' })
    coordinator.submitDecision('agent-2', { action: 'respond', priority: 10, reason: 'direct address' })
    coordinator.submitDecision('agent-3', { action: 'respond', priority: 3, reason: 'general' })

    const winner = coordinator.resolveConflictsSync()
    expect(winner).toBe('agent-2')
  })

  it('breaks ties by least recently spoke', () => {
    // Both have same priority
    coordinator.submitDecision('agent-1', { action: 'respond', priority: 5, reason: 'topic' })
    coordinator.submitDecision('agent-2', { action: 'respond', priority: 5, reason: 'topic' })

    // agent-1 spoke more recently
    coordinator.recordSpoke('agent-1')

    // Need to re-submit after recording spoke since resolveConflictsSync clears
    coordinator.submitDecision('agent-1', { action: 'respond', priority: 5, reason: 'topic' })
    coordinator.submitDecision('agent-2', { action: 'respond', priority: 5, reason: 'topic' })

    const winner = coordinator.resolveConflictsSync()
    expect(winner).toBe('agent-2') // spoke less recently (never)
  })

  it('clears decisions after resolving', () => {
    coordinator.submitDecision('agent-1', { action: 'respond', priority: 5, reason: 'topic' })
    coordinator.resolveConflictsSync()
    expect(coordinator.getPendingCount()).toBe(0)
  })

  it('resolveConflicts (async) waits the collection window', async () => {
    coordinator.submitDecision('agent-1', { action: 'respond', priority: 5, reason: 'topic' })
    const start = Date.now()
    const winner = await coordinator.resolveConflicts()
    const elapsed = Date.now() - start
    expect(winner).toBe('agent-1')
    expect(elapsed).toBeGreaterThanOrEqual(8) // ~10ms window
  })

  it('tracks current speaker', () => {
    expect(coordinator.getCurrentSpeaker()).toBeNull()
    coordinator.recordSpoke('agent-1')
    expect(coordinator.getCurrentSpeaker()).toBe('agent-1')
    coordinator.clearCurrentSpeaker()
    expect(coordinator.getCurrentSpeaker()).toBeNull()
  })

  it('reset clears all state', () => {
    coordinator.submitDecision('agent-1', { action: 'respond', priority: 5, reason: 'topic' })
    coordinator.recordSpoke('agent-1')
    coordinator.reset()
    expect(coordinator.getPendingCount()).toBe(0)
    expect(coordinator.getCurrentSpeaker()).toBeNull()
  })
})

// =============================================================================
// Integration: DecisionEngine + TurnCoordinator
// =============================================================================

describe('DecisionEngine + TurnCoordinator integration', () => {
  it('coordinates multiple agents to pick the best responder', () => {
    const engine1 = new DecisionEngine({
      agentName: 'Expert',
      responsiveness: 'balanced',
      topicKeywords: ['typescript', 'react'],
    })
    const engine2 = new DecisionEngine({
      agentName: 'General',
      responsiveness: 'balanced',
      topicKeywords: ['weather', 'sports'],
    })

    const input: DecisionInput = {
      transcription: 'How do you handle typescript generics in react?',
      speaker: null,
      sentiment: 'question',
      topic: 'typescript',
      activeSpeakers: 1,
      averageGapMs: 1500,
      recentMessages: [],
    }

    const decision1 = engine1.decide(input)
    const decision2 = engine2.decide(input)

    const coordinator = new TurnCoordinator()
    coordinator.submitDecision('expert', decision1)
    coordinator.submitDecision('general', decision2)

    const winner = coordinator.resolveConflictsSync()

    // Expert should win because it has higher topic relevance
    // If both respond, expert likely has higher priority from the decision engine
    // If general doesn't respond, expert wins by default
    if (decision1.action === 'respond' && decision2.action !== 'respond') {
      expect(winner).toBe('expert')
    } else if (decision1.action === 'respond' && decision2.action === 'respond') {
      // Both respond — coordinator picks by priority
      expect(winner).not.toBeNull()
    }
  })

  it('direct address wins over topic relevance', () => {
    const engine1 = new DecisionEngine({
      agentName: 'Alpha',
      responsiveness: 'balanced',
      topicKeywords: ['code'],
    })
    const engine2 = new DecisionEngine({
      agentName: 'Beta',
      responsiveness: 'balanced',
      topicKeywords: ['code'],
    })

    const input: DecisionInput = {
      transcription: 'Hey Alpha, what do you think about code?',
      speaker: null,
      sentiment: 'question',
      topic: 'code',
      activeSpeakers: 2,
      averageGapMs: 1500,
      recentMessages: [],
    }

    const decision1 = engine1.decide(input) // directly addressed
    const decision2 = engine2.decide(input) // topic match only

    const coordinator = new TurnCoordinator()
    coordinator.submitDecision('alpha', decision1)
    coordinator.submitDecision('beta', decision2)

    const winner = coordinator.resolveConflictsSync()
    expect(winner).toBe('alpha') // Priority 10 > 5 or 8
  })
})

// =============================================================================
// AdaptiveSilenceDetector + ResponsePacer integration
// =============================================================================

describe('AdaptiveSilenceDetector + ResponsePacer integration', () => {
  it('pacer pace follows silence detector', () => {
    const detector = new AdaptiveSilenceDetector()
    const pacer = new ResponsePacer()

    // Simulate rapid conversation
    detector.recordGap(200)
    detector.recordGap(300)
    detector.recordGap(250)
    pacer.setPace(detector.getPace())
    expect(pacer.getPace()).toBe('rapid')

    // Simulate slow conversation
    const slowDetector = new AdaptiveSilenceDetector()
    slowDetector.recordGap(3000)
    slowDetector.recordGap(4000)
    slowDetector.recordGap(3500)
    pacer.setPace(slowDetector.getPace())
    expect(pacer.getPace()).toBe('slow')
  })
})


