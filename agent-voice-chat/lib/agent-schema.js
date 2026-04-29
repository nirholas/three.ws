// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

const { z } = require("zod")

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/

const ThemeSchema = z.object({
  primary: z.string().regex(HEX_COLOR_REGEX, "Must be a hex color (e.g. #ff00aa)").optional(),
  gradient: z.array(z.string()).optional(),
  background: z.array(z.string()).optional()
}).optional()

const AgentSchema = z.object({
  id: z.string()
    .min(1, "Agent ID is required")
    .max(64, "Agent ID must be 64 characters or fewer")
    .regex(/^[a-z0-9-]+$/, "Agent ID must be lowercase alphanumeric with hyphens only"),
  name: z.string()
    .min(1, "Agent name is required")
    .max(100, "Agent name must be 100 characters or fewer"),
  personality: z.string()
    .min(10, "Personality must be at least 10 characters")
    .optional()
    .default(""),
  voice: z.string().optional(),
  avatar: z.string().optional().default(""),
  theme: ThemeSchema
})

const ConfigSchema = z.object({
  agents: z.array(AgentSchema).min(1, "Config must have at least one agent"),
  basePrompt: z.string().optional(),
  defaults: z.object({
    voice: z.string().optional(),
    maxHistoryLength: z.number().int().positive().optional()
  }).optional()
})

/**
 * Validate a full config object against the schema.
 * Returns { ok: true, data } or { ok: false, errors }.
 */
function validateConfig(config) {
  const result = ConfigSchema.safeParse(config)
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(e => ({
        path: e.path.join("."),
        message: e.message
      }))
    }
  }

  // Check for duplicate IDs (Zod can't do cross-item checks)
  const ids = new Set()
  const duplicates = []
  for (const agent of result.data.agents) {
    if (ids.has(agent.id)) {
      duplicates.push(agent.id)
    }
    ids.add(agent.id)
  }
  if (duplicates.length > 0) {
    return {
      ok: false,
      errors: duplicates.map(id => ({
        path: "agents",
        message: `Duplicate agent ID: "${id}"`
      }))
    }
  }

  return { ok: true, data: result.data }
}

/**
 * Validate a single agent object.
 * Returns { ok: true, data } or { ok: false, errors }.
 */
function validateAgent(agent) {
  const result = AgentSchema.safeParse(agent)
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(e => ({
        path: e.path.join("."),
        message: e.message
      }))
    }
  }
  return { ok: true, data: result.data }
}

module.exports = {
  AgentSchema,
  ConfigSchema,
  ThemeSchema,
  HEX_COLOR_REGEX,
  validateConfig,
  validateAgent
}
