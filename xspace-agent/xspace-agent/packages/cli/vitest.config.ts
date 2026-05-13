// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§32]

import { defineConfig } from 'vitest/config'
import * as path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      // @xspace/server has no dist/ in dev; alias to a stub so vi.mock() can intercept it
      '@xspace/server': path.resolve(__dirname, 'tests/__mocks__/@xspace/server.ts'),
      // Same for xspace-agent — its dist may not exist in the CLI test context
      'xspace-agent': path.resolve(__dirname, 'tests/__mocks__/xspace-agent.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', '**/*.test.ts'],
    },
    testTimeout: 10000,
  },
})


