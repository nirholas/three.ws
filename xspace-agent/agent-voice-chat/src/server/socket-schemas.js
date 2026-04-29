// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const { z } = require("zod")

// ── Socket event validation schemas ────────────────────────────

const JoinRoomSchema = z.object({
  roomId: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, "Invalid room ID format").optional(),
  nickname: z.string().min(1).max(50).optional()
}).optional().default({})

const AgentConnectSchema = z.object({
  agentId: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/, "Invalid agent ID format")
})

const AgentDisconnectSchema = z.object({
  agentId: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/, "Invalid agent ID format")
})

const StatusChangeSchema = z.object({
  agentId: z.string().min(1).max(50),
  status: z.enum(["idle", "speaking", "listening", "offline"])
})

const RequestTurnSchema = z.object({
  agentId: z.string().min(1).max(50)
})

const ReleaseTurnSchema = z.object({
  agentId: z.string().min(1).max(50)
})

const TextDeltaSchema = z.object({
  agentId: z.string().min(1).max(50),
  delta: z.string(),
  messageId: z.string().min(1)
})

const TextCompleteSchema = z.object({
  agentId: z.string().min(1).max(50),
  text: z.string().min(1).max(50000),
  messageId: z.string().min(1)
})

// Base64 pattern: only valid base64 characters
const BASE64_REGEX = /^[A-Za-z0-9+/\n\r]*={0,2}$/

const AudioDataSchema = z.object({
  agentId: z.string().min(1).max(50),
  audio: z.string().min(1).regex(BASE64_REGEX, "Invalid base64 encoding"),
  mimeType: z.string().max(50).optional()
})

const UserMessageSchema = z.object({
  text: z.string().min(1).max(5000),
  from: z.string().max(50).optional()
})

const TextToAgentDirectSchema = z.object({
  agentId: z.string().min(1).max(50),
  text: z.string().min(1).max(5000),
  from: z.string().max(50).optional()
})

const AudioLevelSchema = z.object({
  agentId: z.string().min(1).max(50),
  level: z.number().min(0).max(1)
})

// ── Socket-handler.js specific schemas ─────────────────────────

const AgentJoinSchema = z.object({
  spaceUrl: z.string().min(1).max(500)
})

const AgentSaySchema = z.object({
  agentId: z.string().min(1).max(50),
  text: z.string().min(1).max(5000)
})

const Agent2faSchema = z.object({
  code: z.string().min(1).max(20)
})

const ConfigUpdateSchema = z.object({
  id: z.string().min(1).max(50).optional()
}).passthrough() // Allow additional config fields

const SubscribeSchema = z.array(z.string().min(1).max(50))

/**
 * Validate socket event data against a Zod schema.
 * Returns { ok: true, data } on success, { ok: false, error } on failure.
 */
function validateSocketEvent(schema, data) {
  const result = schema.safeParse(data)
  if (result.success) {
    return { ok: true, data: result.data }
  }
  const issues = result.error.issues.map(i => ({
    path: i.path.join("."),
    message: i.message
  }))
  return { ok: false, error: { code: "VALIDATION_ERROR", message: "Invalid event data", details: issues } }
}

module.exports = {
  JoinRoomSchema,
  AgentConnectSchema,
  AgentDisconnectSchema,
  StatusChangeSchema,
  RequestTurnSchema,
  ReleaseTurnSchema,
  TextDeltaSchema,
  TextCompleteSchema,
  AudioDataSchema,
  UserMessageSchema,
  TextToAgentDirectSchema,
  AudioLevelSchema,
  AgentJoinSchema,
  AgentSaySchema,
  Agent2faSchema,
  ConfigUpdateSchema,
  SubscribeSchema,
  validateSocketEvent
}


