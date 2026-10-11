/**
 * Dev-gated logger utility.
 *
 * In production builds, `debug` and `info` are no-ops (tree-shaken by Vite).
 * `warn` and `error` always log - they indicate real issues.
 *
 * Usage:
 *   import { logger } from '@/utils/logger';
 *   logger.debug('[Tag]', 'message');
 *   logger.info('[Tag]', 'message');
 *   logger.warn('[Tag]', 'message');
 *   logger.error('[Tag]', 'message', err);
 */

const IS_DEV = import.meta.env.DEV;

function noop(..._args: unknown[]): void {
  // intentionally empty - stripped in production
}

export const logger = {
  /** Verbose debug output - dev only */
  debug: IS_DEV ? console.debug.bind(console) : noop,

  /** Informational - dev only */
  info: IS_DEV ? console.log.bind(console) : noop,

  /** Warnings - always logged */
  warn: console.warn.bind(console),

  /** Errors - always logged */
  error: console.error.bind(console),
} as const;
