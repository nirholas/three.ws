// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

/**
 * Simple in-memory metrics tracker.
 * Tracks STT, LLM, TTS call counts, latencies, errors, cost estimates,
 * and a rolling response-time histogram for p95 calculation.
 */

const RESPONSE_TIME_WINDOW = 200 // keep last N samples for percentile calc

class ResponseTimeTracker {
  constructor() {
    this._samples = []
  }

  record(ms) {
    this._samples.push(ms)
    if (this._samples.length > RESPONSE_TIME_WINDOW) {
      this._samples.shift()
    }
  }

  average() {
    if (this._samples.length === 0) return 0
    const sum = this._samples.reduce((a, b) => a + b, 0)
    return Math.round(sum / this._samples.length)
  }

  p95() {
    if (this._samples.length === 0) return 0
    const sorted = [...this._samples].sort((a, b) => a - b)
    const idx = Math.floor(sorted.length * 0.95)
    return sorted[Math.min(idx, sorted.length - 1)]
  }
}

class MetricsTracker {
  constructor() {
    this.stt = { calls: 0, totalLatencyMs: 0, errors: 0 }
    this.llm = { calls: 0, totalLatencyMs: 0, errors: 0, tokensUsed: 0 }
    this.tts = { calls: 0, totalLatencyMs: 0, errors: 0 }
    this.audio = { chunksProcessed: 0, lastVadState: "idle" }
    this.cost = { today: 0, total: 0 }
    this.lastError = null
    this._dailyResetDate = new Date().toDateString()
    this.responseTime = new ResponseTimeTracker()
    this.totalMessages = 0
  }

  _checkDailyReset() {
    const today = new Date().toDateString()
    if (today !== this._dailyResetDate) {
      this.cost.today = 0
      this._dailyResetDate = today
    }
  }

  recordSTTCall(latencyMs) {
    this.stt.calls++
    this.stt.totalLatencyMs += latencyMs
    this._checkDailyReset()
    // Rough cost estimate: ~$0.006 per minute of audio (~$0.0001 per call)
    this.cost.today += 0.0001
    this.cost.total += 0.0001
  }

  recordSTTError() {
    this.stt.errors++
    this.lastError = `STT error at ${new Date().toISOString()}`
  }

  recordLLMCall(tokenCount, latencyMs) {
    this.llm.calls++
    if (latencyMs) this.llm.totalLatencyMs += latencyMs
    this.llm.tokensUsed += tokenCount || 0
    this._checkDailyReset()
    // Rough cost estimate per token
    const costPerToken = 0.000003
    const cost = (tokenCount || 0) * costPerToken
    this.cost.today += cost
    this.cost.total += cost
  }

  recordLLMError() {
    this.llm.errors++
    this.lastError = `LLM error at ${new Date().toISOString()}`
  }

  recordTTSCall(latencyMs) {
    this.tts.calls++
    this.tts.totalLatencyMs += latencyMs
    this._checkDailyReset()
    this.cost.today += 0.00015
    this.cost.total += 0.00015
  }

  recordTTSError() {
    this.tts.errors++
    this.lastError = `TTS error at ${new Date().toISOString()}`
  }

  recordAudioChunk() {
    this.audio.chunksProcessed++
  }

  setVadState(state) {
    this.audio.lastVadState = state
  }

  recordResponseTime(ms) {
    this.responseTime.record(ms)
  }

  incrementMessageCount() {
    this.totalMessages++
  }

  /**
   * Returns a full snapshot including system resource usage.
   * @param {object} [appDeps] - optional live application state (io, roomManager, etc.)
   */
  getSnapshot(appDeps = {}) {
    this._checkDailyReset()
    const mem = process.memoryUsage()
    return {
      resource: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        heapUsagePercent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
        rss: mem.rss,
        external: mem.external
      },
      application: {
        activeConnections: appDeps.io ? appDeps.io.engine.clientsCount : null,
        activeRooms: appDeps.roomManager ? appDeps.roomManager.getRoomCount() : null,
        totalMessages: this.totalMessages,
        rateLimiterEntries: appDeps.socketLimiter ? appDeps.socketLimiter.size : null,
        conversationStoreSize: appDeps.conversationRouter ? appDeps.conversationRouter._conversations.size : null,
        activeExtractions: appDeps.activeExtractions != null ? appDeps.activeExtractions : null,
        audioQueueDepth: appDeps.audioQueue ? appDeps.audioQueue.length : null
      },
      performance: {
        avgResponseTimeMs: this.responseTime.average(),
        p95ResponseTimeMs: this.responseTime.p95()
      },
      stt: {
        calls: this.stt.calls,
        avgLatencyMs: this.stt.calls > 0 ? Math.round(this.stt.totalLatencyMs / this.stt.calls) : 0,
        errors: this.stt.errors
      },
      llm: {
        calls: this.llm.calls,
        avgLatencyMs: this.llm.calls > 0 ? Math.round(this.llm.totalLatencyMs / this.llm.calls) : 0,
        errors: this.llm.errors,
        tokensUsed: this.llm.tokensUsed
      },
      tts: {
        calls: this.tts.calls,
        avgLatencyMs: this.tts.calls > 0 ? Math.round(this.tts.totalLatencyMs / this.tts.calls) : 0,
        errors: this.tts.errors
      },
      audio: {
        chunksPerSecond: 0,
        vadState: this.audio.lastVadState
      },
      cost: {
        today: Math.round(this.cost.today * 10000) / 10000,
        total: Math.round(this.cost.total * 10000) / 10000
      }
    }
  }
}

module.exports = { MetricsTracker }
