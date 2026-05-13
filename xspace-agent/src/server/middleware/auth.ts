// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

import { timingSafeEqual } from "crypto"
import type { Request, Response, NextFunction } from "express"
import type { Socket } from "socket.io"
import { serverLogger } from "../logger"

const OPEN_PATHS = new Set(["/health", "/ready", "/config", "/", "/bob", "/alice", "/builder", "/landing"])

function extractApiKey(req: Request): string | null {
  // Authorization: Bearer <key>
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7)
  }

  // X-API-Key header
  const xApiKey = req.headers["x-api-key"]
  if (typeof xApiKey === "string" && xApiKey) {
    return xApiKey
  }

  // Query param (deprecated)
  const queryKey = req.query.api_key
  if (typeof queryKey === "string" && queryKey) {
    serverLogger.warn("API key passed via query param — this method is deprecated, use Authorization header instead")
    return queryKey
  }

  return null
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    // Compare against self to keep constant time, then return false
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for open paths and static files
  if (OPEN_PATHS.has(req.path)) {
    return next()
  }

  const adminKey = process.env.ADMIN_API_KEY
  if (!adminKey) {
    // Dev mode: no auth required
    res.setHeader("X-Auth-Warning", "No ADMIN_API_KEY configured")
    return next()
  }

  const key = extractApiKey(req)
  if (!key) {
    res.status(401).json({
      error: {
        code: "AUTH_REQUIRED",
        message: "API key required",
        hint: "Set the Authorization header: Bearer <your-api-key>",
      },
    })
    return
  }

  if (!safeEqual(key, adminKey)) {
    res.status(401).json({
      error: {
        code: "AUTH_INVALID",
        message: "Invalid API key",
      },
    })
    return
  }

  next()
}

export function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void): void {
  const adminKey = process.env.ADMIN_API_KEY
  if (!adminKey) {
    // Dev mode: allow all connections
    return next()
  }

  const token = socket.handshake.auth?.token as string | undefined
  if (!token) {
    return next(new Error("AUTH_REQUIRED"))
  }

  if (!safeEqual(token, adminKey)) {
    return next(new Error("AUTH_INVALID"))
  }

  next()
}

export function logAuthWarning(): void {
  if (!process.env.ADMIN_API_KEY) {
    serverLogger.warn("ADMIN_API_KEY is not set — server is running in dev mode with unauthenticated endpoints")
  }
}


