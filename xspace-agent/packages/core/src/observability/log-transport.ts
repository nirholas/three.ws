// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§89]

// =============================================================================
// Observability – Socket.IO Log Transport
// =============================================================================
//
// Streams structured Pino log entries to connected admin clients via Socket.IO.
// Usage:
//   const transport = new SocketLogTransport(io)
//   pinoLogger.pipe(transport)
// Or use the helper:
//   attachLogStreaming(io, pinoLogger)
// =============================================================================

import { Transform, type TransformCallback } from 'stream'
import pino from 'pino'

interface SocketIOLike {
  to(room: string): { emit(event: string, data: unknown): void }
}

const levelLabels: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
}

export class SocketLogTransport extends Transform {
  private io: SocketIOLike

  constructor(io: SocketIOLike) {
    super({ objectMode: true })
    this.io = io
  }

  _transform(chunk: unknown, _encoding: string, callback: TransformCallback): void {
    try {
      const log =
        typeof chunk === 'string' ? JSON.parse(chunk) : chunk

      const record = log as Record<string, unknown>

      this.io.to('admin').emit('log', {
        level: levelLabels[record.level as number] ?? 'info',
        message: record.msg,
        timestamp: record.time,
        module: record.module,
        context: {
          ...record,
          msg: undefined,
          time: undefined,
          level: undefined,
          module: undefined,
        },
      })
    } catch {
      // Ignore parse errors on malformed chunks
    }
    callback(null, chunk)
  }
}

/**
 * Convenience: create a destination stream that forwards logs to Socket.IO
 * and return a pino logger instance that writes to both stdout and the socket.
 */
export function createStreamingLogger(
  name: string,
  io: SocketIOLike,
  level: string = 'info',
): pino.Logger {
  const transport = new SocketLogTransport(io)

  // Create a multistream: stdout + socket transport
  const streams: pino.StreamEntry[] = [
    { level: level as pino.Level, stream: process.stdout },
    { level: level as pino.Level, stream: transport },
  ]

  return pino(
    {
      name,
      level,
      redact: {
        paths: [
          'auth.token',
          'auth.password',
          'auth.ct0',
          'headers.authorization',
          'headers.cookie',
        ],
        censor: '[REDACTED]',
      },
    },
    pino.multistream(streams),
  )
}


