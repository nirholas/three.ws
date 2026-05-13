// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const { Router } = require("express")
const { validateConfig } = require("../../../lib/agent-schema")

/**
 * @param {object} deps
 * @param {import('../../../agent-registry')} deps.registry
 * @param {object} [deps.ttsProvider] - TTS provider with optional listVoices()
 */
module.exports = function createRegistryRoutes(deps) {
  const { registry, ttsProvider } = deps
  const router = Router()

  // GET /api/agents/registry — List all registered agents with full config
  router.get("/", (req, res) => {
    const agents = registry.getAllAgents()
    const lastErrors = registry.getLastValidationErrors()
    res.success({
      agents,
      count: agents.length,
      defaults: registry.defaults,
      ...(lastErrors ? { lastValidationErrors: lastErrors } : {})
    })
  })

  // GET /api/agents/registry/voices — List available TTS voices
  router.get("/voices", async (req, res) => {
    if (!ttsProvider || typeof ttsProvider.listVoices !== "function") {
      return res.fail("NOT_IMPLEMENTED", "TTS provider does not support listing voices", 501)
    }
    try {
      const voices = await ttsProvider.listVoices()
      // Cross-reference with agent assignments
      const agentVoices = {}
      for (const agent of registry.getAllAgents()) {
        if (agent.voice) agentVoices[agent.voice] = (agentVoices[agent.voice] || []).concat(agent.id)
      }
      res.success({
        voices,
        agentAssignments: agentVoices
      })
    } catch (err) {
      res.fail("PROVIDER_ERROR", `Failed to list voices: ${err.message}`, 502)
    }
  })

  // POST /api/agents/registry/reload — Force config reload from disk
  router.post("/reload", (req, res) => {
    const result = registry.reload()
    if (result.ok) {
      res.success({ reloaded: true, agents: result.agents })
    } else {
      res.fail("VALIDATION_ERROR", `Reload failed: ${result.errors}`, 400)
    }
  })

  // POST /api/agents/registry/validate — Validate config without applying
  router.post("/validate", (req, res) => {
    const config = req.body
    if (!config || typeof config !== "object") {
      return res.fail("VALIDATION_ERROR", "Request body must be a JSON config object", 400)
    }
    const result = validateConfig(config)
    if (result.ok) {
      res.success({
        valid: true,
        agents: result.data.agents.length,
        agentIds: result.data.agents.map(a => a.id)
      })
    } else {
      res.fail("VALIDATION_ERROR", "Config validation failed", 400, result.errors)
    }
  })

  return router
}


