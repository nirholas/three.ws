// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

// =============================================================================
// Observability – Pino Structured Logger
// =============================================================================

import pino from 'pino'

export interface LoggerConfig {
  level?: 'debug' | 'info' | 'warn' | 'error'
  /** Human-readable output (dev mode) */
  pretty?: boolean
  /** Additional key paths to redact */
  redactKeys?: string[]
}

export function createLogger(name: string, config: LoggerConfig = {}): pino.Logger {
  return pino({
    name,
    level: config.level ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    redact: {
      paths: [
        'auth.token',
        'auth.password',
        'auth.ct0',
        'headers.authorization',
        'headers.cookie',
        ...(config.redactKeys ?? []),
      ],
      censor: '[REDACTED]',
    },
    transport: config.pretty
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l' },
        }
      : undefined,
  })
}

/** Create a child logger with additional context. */
export function childLogger(
  parent: pino.Logger,
  context: Record<string, unknown>,
): pino.Logger {
  return parent.child(context)
}

// ---------------------------------------------------------------------------
// Singleton app logger
// ---------------------------------------------------------------------------

let appLogger: pino.Logger | null = null

export function getAppLogger(name?: string): pino.Logger {
  if (!appLogger) {
    appLogger = createLogger('xspace-agent', {
      pretty: process.env.NODE_ENV !== 'production',
      level: (process.env.LOG_LEVEL as LoggerConfig['level']) ?? 'info',
    })
  }
  return name ? appLogger.child({ module: name }) : appLogger
}

/** Replace the singleton (useful for testing or custom transports). */
export function setAppLogger(logger: pino.Logger): void {
  appLogger = logger
}

// ---------------------------------------------------------------------------
// Free-text secret redaction (for log messages and error responses)
// ---------------------------------------------------------------------------

const REDACT_PATTERNS: RegExp[] = [
  // Env var assignments
  /X_AUTH_TOKEN=\S+/g,
  /OPENAI_API_KEY=\S+/g,
  /ANTHROPIC_API_KEY=\S+/g,
  /GROQ_API_KEY=\S+/g,
  /ELEVENLABS_API_KEY=\S+/g,
  /ADMIN_API_KEY=\S+/g,
  /COOKIE_ENCRYPTION_KEY=\S+/g,
  // Common key patterns
  /sk-[a-zA-Z0-9_-]{20,}/g,       // OpenAI keys
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,   // Anthropic keys
  /gsk_[a-zA-Z0-9_-]{20,}/g,      // Groq keys
  // X auth tokens (hex strings)
  /auth_token=[a-f0-9]{40}/g,
]

/**
 * Replace known secret patterns in free-text strings with `[REDACTED]`.
 * Complements Pino's structured key-path redaction for unstructured output
 * (error messages, stack traces, client-facing responses).
 */
export function redactSecrets(text: string): string {
  let result = text
  for (const pattern of REDACT_PATTERNS) {
    pattern.lastIndex = 0
    result = result.replace(pattern, '[REDACTED]')
  }
  return result
}


