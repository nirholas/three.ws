// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

const { Router } = require("express")
const { apiKeyAuth } = require("../middleware/auth")
const { responseHelpers } = require("../middleware/response")
const { generalLimiter } = require("../middleware/rate-limit")

const createAgentRoutes = require("./agents")
const createAgentControlRoutes = require("./agent-control")
const createSystemRoutes = require("./system")
const createRoomRoutes = require("./rooms")
const createConversationRoutes = require("./conversations")
const createPersonalityRoutes = require("./personalities")
const createRegistryRoutes = require("./registry")

/**
 * Mount all API routes under /api
 *
 * @param {object} deps - shared dependencies
 * @returns {Router}
 */
module.exports = function createAPIRouter(deps) {
  const router = Router()

  // Global middleware for all API routes
  router.use(responseHelpers)
  router.use(generalLimiter)

  // Health endpoint is public (no auth required)
  const systemRoutes = createSystemRoutes(deps)
  router.use("/", systemRoutes)

  // Auth middleware for all other routes
  router.use(apiKeyAuth)

  // Personality routes (create first so we can pass store to agent routes)
  const personalityRoutes = createPersonalityRoutes()
  router.use("/personalities", personalityRoutes)

  // Registry routes (mounted at /api/agents/registry) — must come before /agents CRUD
  // so that /agents/registry/* doesn't get caught by the /:id param route
  const registryRoutes = createRegistryRoutes(deps)
  router.use("/agents/registry", registryRoutes)

  // Agent CRUD routes (mounted at /api/agents)
  const agentCrudRoutes = createAgentRoutes({
    ...deps,
    personalityStore: personalityRoutes._store
  })
  router.use("/agents", agentCrudRoutes)

  // Agent control routes (mounted at /api/agent)
  const agentControlRoutes = createAgentControlRoutes({
    ...deps,
    personalityStore: personalityRoutes._store
  })
  router.use("/agent", agentControlRoutes)

  // Room routes
  const roomRoutes = createRoomRoutes(deps)
  router.use("/rooms", roomRoutes)

  // Conversation routes
  const conversationRoutes = createConversationRoutes(deps)
  router.use("/conversations", conversationRoutes)

  return router
}


