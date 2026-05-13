// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§79]

// ===== Input Validation Helpers =====

/** Valid X Space URL pattern */
const X_SPACE_URL_RE = /^https:\/\/(x\.com|twitter\.com)\/i\/spaces\/[a-zA-Z0-9]+$/

/** Alphanumeric ID pattern (for agent IDs, flow IDs, etc.) */
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/

/** Path traversal patterns */
const PATH_TRAVERSAL_RE = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/** Common shell metacharacters */
const SHELL_META_RE = /[;|&$`\\!#~<>{}()\[\]]/

/**
 * Validate that a URL is a valid X Space URL.
 * Prevents arbitrary URL injection in space join operations.
 */
export function isValidSpaceUrl(url: string): boolean {
  if (typeof url !== "string") return false
  try {
    const parsed = new URL(url)
    return (
      (parsed.hostname === "x.com" || parsed.hostname === "twitter.com") &&
      parsed.pathname.startsWith("/i/spaces/") &&
      X_SPACE_URL_RE.test(url)
    )
  } catch {
    return false
  }
}

/**
 * Validate that a string is a safe alphanumeric ID.
 * Use for agent IDs, flow IDs, and any identifier used in file paths or lookups.
 */
export function isSafeId(id: string): boolean {
  if (typeof id !== "string" || id.length === 0 || id.length > 128) return false
  return SAFE_ID_RE.test(id)
}

/**
 * Check a file path for path traversal attempts.
 * Returns true if the path is safe (no traversal detected).
 */
export function isSafePath(filepath: string): boolean {
  if (typeof filepath !== "string") return false
  // Reject path traversal
  if (PATH_TRAVERSAL_RE.test(filepath)) return false
  // Reject absolute paths
  if (filepath.startsWith("/") || /^[a-zA-Z]:/.test(filepath)) return false
  // Reject null bytes
  if (filepath.includes("\0")) return false
  return true
}

/**
 * Validate a string doesn't contain shell metacharacters.
 * Use for any string that might be interpolated into shell commands.
 */
export function isSafeForShell(str: string): boolean {
  if (typeof str !== "string") return false
  return !SHELL_META_RE.test(str)
}

/**
 * Validate an agent ID is a valid number (0 or 1 for legacy server).
 */
export function isValidAgentId(id: unknown): id is number {
  return typeof id === "number" && Number.isInteger(id) && (id === 0 || id === 1)
}

/**
 * Validate a 2FA code format (6-8 digits).
 */
export function isValid2faCode(code: string): boolean {
  return typeof code === "string" && /^\d{6,8}$/.test(code)
}


