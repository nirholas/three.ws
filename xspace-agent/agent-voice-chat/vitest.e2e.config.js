// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/e2e/**/*.e2e.test.js"],
    testTimeout: 60000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    fileParallelism: false,
  }
})


