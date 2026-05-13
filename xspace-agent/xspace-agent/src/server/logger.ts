// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§75]

import pino from "pino"
import { readFileSync } from "fs"
import { join } from "path"

let version = "0.0.0"
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"))
  version = pkg.version
} catch {
  // fallback version
}

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  base: { service: "xspace-agent", version },
})

// Child loggers for each domain
export const serverLogger = logger.child({ component: "server" })
export const socketLogger = logger.child({ component: "socket" })
export const routeLogger = logger.child({ component: "routes" })
export const browserLogger = logger.child({ component: "browser" })
export const spaceUILogger = logger.child({ component: "space-ui" })
export const authLogger = logger.child({ component: "auth" })
export const audioLogger = logger.child({ component: "audio" })
export const xSpacesLogger = logger.child({ component: "x-spaces" })

export default logger


