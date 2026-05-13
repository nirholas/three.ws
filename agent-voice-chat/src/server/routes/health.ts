// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import { Router, Request, Response } from "express"
import { registry } from "../metrics"
import type { SpaceState } from "../../types"

interface ReadinessDeps {
  spaceState: SpaceState
  getSocketConnectionCount: () => number
}

// Cache readiness results for 5 seconds
let readinessCache: { data: unknown; status: number; timestamp: number } | null = null
const READINESS_CACHE_TTL = 5_000

let isShuttingDown = false

export function setShuttingDown(value: boolean): void {
  isShuttingDown = value
}

export function getIsShuttingDown(): boolean {
  return isShuttingDown
}

const startTime = Date.now()

export function createHealthRoutes(deps: ReadinessDeps): Router {
  const router = Router()

  // GET /health — lightweight liveness check
  router.get("/health", (_req: Request, res: Response) => {
    if (isShuttingDown) {
      return res.status(503).json({
        status: "shutting_down",
        uptime: Math.floor((Date.now() - startTime) / 1000),
        version: process.env.npm_package_version || "0.1.0",
        timestamp: new Date().toISOString(),
      })
    }

    res.json({
      status: "ok",
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version: process.env.npm_package_version || "0.1.0",
      timestamp: new Date().toISOString(),
    })
  })

  // GET /ready — readiness check with cached results
  router.get("/ready", (_req: Request, res: Response) => {
    if (isShuttingDown) {
      return res.status(503).json({ status: "shutting_down" })
    }

    const now = Date.now()
    if (readinessCache && now - readinessCache.timestamp < READINESS_CACHE_TTL) {
      return res.status(readinessCache.status).json(readinessCache.data)
    }

    const checks = buildReadinessChecks(deps)
    const hasCriticalFailure = checks.server.status === "error"

    const data = {
      status: hasCriticalFailure ? "not_ready" : "ready",
      checks,
    }
    const statusCode = hasCriticalFailure ? 503 : 200

    readinessCache = { data, status: statusCode, timestamp: now }
    res.status(statusCode).json(data)
  })

  // GET /metrics — Prometheus text exposition format
  router.get("/metrics", async (_req: Request, res: Response) => {
    try {
      const metrics = await registry.metrics()
      res.set("Content-Type", registry.contentType)
      res.end(metrics)
    } catch {
      res.status(500).end("Error collecting metrics")
    }
  })

  return router
}

function buildReadinessChecks(deps: ReadinessDeps) {
  const { spaceState, getSocketConnectionCount } = deps

  // Server check — always ok if we got here
  const serverCheck: { status: string } = { status: "ok" }

  // Agent check — count connected agents
  const connectedAgents = Object.values(spaceState.agents).filter((a) => a.connected)
  const agentCheck = {
    status: "ok" as const,
    activeAgents: connectedAgents.length,
    totalAgents: Object.keys(spaceState.agents).length,
  }

  // Socket.IO check
  const connectionCount = getSocketConnectionCount()
  const socketCheck = {
    status: "ok" as const,
    connections: connectionCount,
  }

  return {
    server: serverCheck,
    agents: agentCheck,
    socketio: socketCheck,
  }
}


