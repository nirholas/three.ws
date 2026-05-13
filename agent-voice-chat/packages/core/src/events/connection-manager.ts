// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§84]

// =============================================================================
// Event Streaming — Connection Manager
// =============================================================================

import type { Response } from 'express'
import type { ConnectionLimits } from './types'
import { DEFAULT_CONNECTION_LIMITS } from './types'

interface SSEConnection {
  id: string
  orgId: string
  res: Response
  heartbeatTimer: ReturnType<typeof setInterval>
  createdAt: number
}

/**
 * Manages SSE connections with per-org limits, heartbeats, backpressure detection,
 * and graceful connection draining on shutdown.
 */
export class ConnectionManager {
  private connections = new Map<string, SSEConnection>()
  private orgCounts = new Map<string, number>()
  private draining = false
  private readonly limits: ConnectionLimits

  constructor(limits?: Partial<ConnectionLimits>) {
    this.limits = { ...DEFAULT_CONNECTION_LIMITS, ...limits }
  }

  /** Get the current number of SSE connections for an org. */
  getSSECount(orgId: string): number {
    return this.orgCounts.get(orgId) ?? 0
  }

  /** Get total connection count across all orgs. */
  getTotalCount(): number {
    return this.connections.size
  }

  /**
   * Register a new SSE connection. Returns false if the org has hit its limit.
   * Sets up heartbeat and connection cleanup on close.
   */
  addSSE(id: string, orgId: string, res: Response): boolean {
    if (this.draining) return false

    const count = this.getSSECount(orgId)
    if (count >= this.limits.maxSSEPerOrg) return false

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    })

    // Send retry hint
    res.write(`retry: ${this.limits.sseRetryMs}\n\n`)

    // Set up heartbeat
    const heartbeatTimer = setInterval(() => {
      if (!res.writableEnded) {
        res.write(':keepalive\n\n')
      }
    }, this.limits.heartbeatIntervalMs)

    const conn: SSEConnection = { id, orgId, res, heartbeatTimer, createdAt: Date.now() }
    this.connections.set(id, conn)
    this.orgCounts.set(orgId, count + 1)

    // Cleanup on close
    res.on('close', () => this.removeSSE(id))

    return true
  }

  /** Remove an SSE connection and clean up resources. */
  removeSSE(id: string): void {
    const conn = this.connections.get(id)
    if (!conn) return

    clearInterval(conn.heartbeatTimer)
    this.connections.delete(id)

    const count = this.orgCounts.get(conn.orgId) ?? 0
    if (count <= 1) {
      this.orgCounts.delete(conn.orgId)
    } else {
      this.orgCounts.set(conn.orgId, count - 1)
    }

    if (!conn.res.writableEnded) {
      conn.res.end()
    }
  }

  /**
   * Send an SSE event to a specific connection.
   * Implements basic backpressure: if the write buffer is full, skip the event.
   */
  sendEvent(connectionId: string, eventType: string, data: string, eventId?: string): boolean {
    const conn = this.connections.get(connectionId)
    if (!conn || conn.res.writableEnded) return false

    // Backpressure check: if the kernel write buffer is above high-water mark, skip
    const socket = conn.res.socket
    if (socket && socket.writableLength > (socket.writableHighWaterMark ?? 16384)) {
      return false
    }

    let message = ''
    if (eventId) message += `id: ${eventId}\n`
    message += `event: ${eventType}\n`
    message += `data: ${data}\n\n`

    return conn.res.write(message)
  }

  /**
   * Drain all connections gracefully. Sends a `reconnect` event to each client,
   * then closes the connections.
   */
  async drain(): Promise<void> {
    this.draining = true

    for (const [id, conn] of this.connections) {
      if (!conn.res.writableEnded) {
        conn.res.write('event: reconnect\ndata: {"reason":"server_shutdown"}\n\n')
      }
      this.removeSSE(id)
    }
  }

  /** Get a list of all active connection IDs for an org. */
  getConnectionIds(orgId: string): string[] {
    const ids: string[] = []
    for (const [id, conn] of this.connections) {
      if (conn.orgId === orgId) ids.push(id)
    }
    return ids
  }
}


