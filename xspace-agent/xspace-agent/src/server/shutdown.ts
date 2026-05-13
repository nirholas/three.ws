// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

import http from "http"
import { Server as SocketIOServer } from "socket.io"
import { setShuttingDown } from "./routes/health"
import { serverLogger } from "./logger"

const SHUTDOWN_TIMEOUT = 30_000

export function setupGracefulShutdown(
  server: http.Server,
  io: SocketIOServer,
): void {
  let shutdownInProgress = false

  const shutdown = async (signal: string) => {
    if (shutdownInProgress) return
    shutdownInProgress = true

    serverLogger.info({ signal }, "received signal, starting graceful shutdown")

    // Step 1: Mark as shutting down (health returns 503)
    setShuttingDown(true)

    // Step 2: Stop accepting new connections
    server.close(() => {
      serverLogger.info("HTTP server closed")
    })

    // Step 3: Close Socket.IO connections gracefully
    serverLogger.info("closing Socket.IO connections")
    io.disconnectSockets(true)
    await new Promise<void>((resolve) => {
      io.close(() => {
        serverLogger.info("Socket.IO server closed")
        resolve()
      })
    })

    // Step 4: Force exit after timeout
    const forceExitTimer = setTimeout(() => {
      serverLogger.fatal("timed out after 30s, forcing exit")
      process.exit(1)
    }, SHUTDOWN_TIMEOUT)
    forceExitTimer.unref()

    serverLogger.info("graceful shutdown complete")
    process.exit(0)
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"))
  process.on("SIGINT", () => shutdown("SIGINT"))
}


