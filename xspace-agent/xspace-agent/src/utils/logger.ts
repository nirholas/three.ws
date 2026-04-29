// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import pino from "pino";

export const logger = pino({
  transport:
    process.env["NODE_ENV"] !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  level: process.env["LOG_LEVEL"] ?? "info",
  base: { service: "xspace-agent" },
});

export function createChildLogger(module: string): pino.Logger {
  return logger.child({ module });
}


