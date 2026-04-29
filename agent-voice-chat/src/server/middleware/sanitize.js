// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

const MAX_MESSAGE_LENGTH = 2000

// Patterns that could be used for prompt injection
const INJECTION_PATTERNS = [
  /\[SYSTEM\]/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<<SYS>>/gi,
  /<<\\?\/SYS>>/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<\|system\|>/gi,
  /<\|user\|>/gi,
  /<\|assistant\|>/gi
]

// Strip HTML tags (and script tag content entirely)
function stripHtml(str) {
  return str
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]*>/g, "")
}

// Remove prompt injection patterns
function stripInjection(str) {
  let result = str
  for (const pattern of INJECTION_PATTERNS) {
    result = result.replace(pattern, "")
  }
  return result
}

/**
 * Truncate to at most `maxLength` Unicode code points without splitting
 * surrogate pairs or multi-byte characters.
 */
function truncateToCodePoints(str, maxLength) {
  // Spread into an array of Unicode code points (handles emoji & surrogates correctly)
  const points = [...str]
  if (points.length <= maxLength) return str
  return points.slice(0, maxLength).join("")
}

/**
 * Sanitize user message text:
 * - Normalize Unicode (NFKC) to prevent homograph attacks
 * - Strip HTML tags
 * - Remove prompt injection patterns
 * - Limit length (codepoint-aware, never cuts mid-emoji)
 */
function sanitizeMessage(text) {
  if (typeof text !== "string") return ""
  // NFKC normalization collapses visually-similar characters
  let clean = text.normalize("NFKC")
  clean = stripInjection(clean)
  clean = stripHtml(clean)
  clean = clean.trim()
  clean = truncateToCodePoints(clean, MAX_MESSAGE_LENGTH)
  return clean
}

// Validate agent ID against registry
function validateAgentId(registry, agentId) {
  if (typeof agentId !== "string") return false
  return registry.getAgent(agentId) !== null
}

// Validate room ID format (alphanumeric, hyphens, underscores, 1-64 chars)
function validateRoomId(roomId) {
  if (typeof roomId !== "string") return false
  return /^[a-zA-Z0-9_-]{1,64}$/.test(roomId)
}

/**
 * Format user input for LLM consumption using structured delimiters.
 * Separates user content from system framing to reduce prompt injection risk.
 */
function formatChatForLLM(from, text) {
  const cleanFrom = sanitizeMessage(from || "").slice(0, 50) || "User"
  const cleanText = sanitizeMessage(text || "")
  return `[USER_MESSAGE speaker="${cleanFrom}"]\n${cleanText}\n[/USER_MESSAGE]`
}

module.exports = { sanitizeMessage, validateAgentId, validateRoomId, formatChatForLLM, MAX_MESSAGE_LENGTH }
