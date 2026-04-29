// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.js"],
    exclude: ["tests/e2e/**"],
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "lib/**/*.js",
        "providers/index.js",
        "providers/openai-realtime.js",
        "providers/conversation-history.js",
        "agent-registry.js",
        "room-manager.js",
        "src/server/middleware/**/*.js",
        "src/server/routes/agents.js",
        "src/server/routes/rooms.js",
        "src/server/routes/system.js",
        "src/server/routes/registry.js"
      ],
      exclude: [],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80
      }
    }
  }
})
