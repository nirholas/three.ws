// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

'use strict'

// ============================================================
// Shared application-wide constants.
// Import from here instead of scattering magic numbers.
// ============================================================

module.exports = {
  // ── Message limits ──────────────────────────────────────────
  /** Maximum messages retained per room (maps to CircularBuffer capacity). */
  MAX_MESSAGES_PER_ROOM: 100,
  /** Number of most-recent messages sent to a connecting client. */
  MAX_HISTORY_SLICE: 50,

  // ── Audio ───────────────────────────────────────────────────
  /** Maximum accepted audio payload in bytes (5 MB). */
  MAX_AUDIO_SIZE_BYTES: 5 * 1024 * 1024,

  // ── Timing ──────────────────────────────────────────────────
  /** Delay (ms) before the next agent in the queue receives its turn. */
  TURN_DELAY_MS: 500,
  /** How often (ms) provider health checks run (5 minutes). */
  HEALTH_CHECK_INTERVAL_MS: 5 * 60 * 1000,
  /** Socket.IO ping timeout in milliseconds. */
  SOCKET_PING_TIMEOUT_MS: 60000,
  /** Socket.IO ping interval in milliseconds. */
  SOCKET_PING_INTERVAL_MS: 25000,
  /** Default stream timeout for LLM responses (2 minutes). */
  STREAM_TIMEOUT_MS: 120_000,
  /** Metrics broadcast interval in milliseconds (5 seconds). */
  METRICS_BROADCAST_INTERVAL_MS: 5000,

  // ── Rate limiting ────────────────────────────────────────────
  /** Rolling window for rate limiters (ms). */
  DEFAULT_RATE_LIMIT_WINDOW_MS: 60 * 1000,
  /** Default maximum requests within the rate-limit window. */
  DEFAULT_RATE_LIMIT_MAX: 30,
  /** Socket.IO audio events per minute per socket. */
  SOCKET_AUDIO_RATE_LIMIT: 10,
  /** Socket.IO user message events per minute per socket. */
  SOCKET_MESSAGE_RATE_LIMIT: 30,
  /** Socket.IO agent:say events per minute per socket. */
  SOCKET_AGENT_SAY_RATE_LIMIT: 20,

  // ── Per-role rate limit tiers ──────────────────────────────
  /** Rate limit multipliers by role. Limits are multiplied by these factors. */
  RATE_LIMIT_TIERS: {
    admin:     { general: 1000, message: 200, session: 50 },
    operator:  { general: 500,  message: 100, session: 20 },
    viewer:    { general: 200,  message: 50,  session: 10 },
    anonymous: { general: 100,  message: 20,  session: 5 },
  },

  // ── Audio rate limiting ────────────────────────────────────
  /** Max audio chunks per second (real-time audio needs high throughput). */
  AUDIO_MAX_CHUNKS_PER_SECOND: 50,
  /** Max audio bytes per minute (10 MB). */
  AUDIO_MAX_BYTES_PER_MINUTE: 10 * 1024 * 1024,

  // ── Pagination ───────────────────────────────────────────────
  /** Records returned when the caller omits a `limit` parameter. */
  DEFAULT_PAGE_SIZE: 20,
  /** Hard upper bound on the number of records returned per page. */
  MAX_PAGE_SIZE: 100,

  // ── Health ───────────────────────────────────────────────────
  /** Memory heap usage threshold for health check warning (500 MB). */
  MEMORY_WARNING_THRESHOLD_BYTES: 500 * 1024 * 1024,
  /** Connected sockets threshold for health check warning. */
  SOCKET_WARNING_THRESHOLD: 1000,

  // ── Sanitization ─────────────────────────────────────────────
  /** Maximum display name length after truncation. */
  MAX_DISPLAY_NAME_LENGTH: 50,

  // ── Provider types ───────────────────────────────────────────
  /** String identifiers for the supported provider transport modes. */
  PROVIDER_TYPES: {
    WEBRTC: 'webrtc',
    SOCKET: 'socket',
    CHAT: 'chat',
  },
}
