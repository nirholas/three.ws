// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

// =============================================================================
// Pluggable logger — bridges the legacy Logger interface with Pino
// =============================================================================

import { getAppLogger, redactSecrets } from './observability/logger'

export { redactSecrets }
import type pino from 'pino'

export interface Logger {
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
  debug(msg: string, ...args: unknown[]): void
}

/**
 * Create a Logger adapter that delegates to a Pino child logger.
 * Structured context is passed as the first argument to each Pino call.
 */
function formatMsg(msg: string, args: unknown[]): string {
  if (args.length === 0) return msg
  const parts = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
  return `${msg} ${parts.join(' ')}`
}

function pinoAdapter(pinoLogger: pino.Logger): Logger {
  return {
    info: (msg, ...args) => {
      if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
        pinoLogger.info(args[0] as Record<string, unknown>, formatMsg(msg, args.slice(1)))
      } else {
        pinoLogger.info(formatMsg(msg, args))
      }
    },
    warn: (msg, ...args) => {
      if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
        pinoLogger.warn(args[0] as Record<string, unknown>, formatMsg(msg, args.slice(1)))
      } else {
        pinoLogger.warn(formatMsg(msg, args))
      }
    },
    error: (msg, ...args) => {
      if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
        pinoLogger.error(args[0] as Record<string, unknown>, formatMsg(msg, args.slice(1)))
      } else {
        pinoLogger.error(formatMsg(msg, args))
      }
    },
    debug: (msg, ...args) => {
      if (args.length > 0 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
        pinoLogger.debug(args[0] as Record<string, unknown>, formatMsg(msg, args.slice(1)))
      } else {
        pinoLogger.debug(formatMsg(msg, args))
      }
    },
  }
}

let currentLogger: Logger | null = null

export function getLogger(): Logger {
  if (!currentLogger) {
    currentLogger = pinoAdapter(getAppLogger())
  }
  return currentLogger
}

export function setLogger(logger: Logger): void {
  currentLogger = logger
}


