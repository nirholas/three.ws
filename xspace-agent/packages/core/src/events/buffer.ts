// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§85]

// =============================================================================
// Event Streaming — Buffer for replay / reconnection catch-up
// =============================================================================

import type { EventEnvelope } from './types'

/**
 * In-memory ring buffer that stores the last N events per session per org.
 * Used to serve the `/v1/events/replay` endpoint so that reconnecting
 * clients can catch up from their last-seen event ID.
 */
export class EventBuffer {
  /** Map of `orgId:sessionId` → circular buffer of envelopes. */
  private buffers = new Map<string, EventEnvelope[]>()
  /** Global ordered list of all envelopes (for non-session replay). */
  private global = new Map<string, EventEnvelope[]>()

  constructor(private readonly maxPerSession: number = 100) {}

  /** Append an envelope to the buffer. */
  push(envelope: EventEnvelope): void {
    // Per-session buffer
    const data = envelope.event.data as Record<string, unknown>
    if (typeof data.sessionId === 'string') {
      const key = `${envelope.orgId}:${data.sessionId}`
      let buf = this.buffers.get(key)
      if (!buf) {
        buf = []
        this.buffers.set(key, buf)
      }
      buf.push(envelope)
      if (buf.length > this.maxPerSession) {
        buf.splice(0, buf.length - this.maxPerSession)
      }
    }

    // Global per-org buffer
    let orgBuf = this.global.get(envelope.orgId)
    if (!orgBuf) {
      orgBuf = []
      this.global.set(envelope.orgId, orgBuf)
    }
    orgBuf.push(envelope)
    // Keep at most 500 events per org globally
    if (orgBuf.length > 500) {
      orgBuf.splice(0, orgBuf.length - 500)
    }
  }

  /**
   * Replay events for an org, optionally filtered by session and since a given event ID.
   * Returns events **after** the `sinceEventId` (exclusive).
   */
  replay(
    orgId: string,
    options: { sessionId?: string; sinceEventId?: string; limit?: number } = {},
  ): EventEnvelope[] {
    const { sessionId, sinceEventId, limit = 100 } = options

    let source: EventEnvelope[]
    if (sessionId) {
      source = this.buffers.get(`${orgId}:${sessionId}`) ?? []
    } else {
      source = this.global.get(orgId) ?? []
    }

    let startIndex = 0
    if (sinceEventId) {
      const idx = source.findIndex((e) => e.id === sinceEventId)
      if (idx >= 0) {
        startIndex = idx + 1
      }
    }

    return source.slice(startIndex, startIndex + limit)
  }

  /** Clear all buffers for an org (e.g., on org deletion). */
  clearOrg(orgId: string): void {
    this.global.delete(orgId)
    for (const key of this.buffers.keys()) {
      if (key.startsWith(`${orgId}:`)) {
        this.buffers.delete(key)
      }
    }
  }

  /** Clear a specific session's buffer. */
  clearSession(orgId: string, sessionId: string): void {
    this.buffers.delete(`${orgId}:${sessionId}`)
  }
}


