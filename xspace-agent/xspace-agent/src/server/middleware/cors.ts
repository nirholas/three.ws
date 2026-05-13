// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import cors from "cors"
import type { RequestHandler } from "express"

export function createCorsMiddleware(): RequestHandler {
  const originsEnv = process.env.CORS_ORIGINS
  const allowedOrigins: string[] = []

  if (originsEnv) {
    allowedOrigins.push(
      ...originsEnv
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    )
  }

  const isDev = !process.env.ADMIN_API_KEY

  return cors({
    origin(origin, callback) {
      // Allow requests with no origin (same-origin, curl, mobile apps)
      if (!origin) {
        return callback(null, true)
      }

      // Always allow same-origin
      if (allowedOrigins.includes(origin)) {
        return callback(null, true)
      }

      // Dev mode: allow localhost on any port
      if (isDev && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        return callback(null, true)
      }

      callback(new Error(`Origin ${origin} not allowed by CORS`))
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
  })
}


