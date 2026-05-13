// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§69]

import { defineConfig } from 'vitest/config'
import path from 'path'

const mockDir = path.resolve(__dirname, 'tests/__mocks__')

export default defineConfig({
  resolve: {
    alias: {
      // Map xspace-agent sub-path imports that aren't in the package exports
      // map to local stub mocks so Vite can resolve them without errors.
      'xspace-agent/cicd': path.join(mockDir, 'xspace-agent-cicd.ts'),
      'xspace-agent/rbac/permissions': path.join(mockDir, 'xspace-agent-rbac.ts'),
      'xspace-agent/tenant/types': path.join(mockDir, 'xspace-agent-tenant-types.ts'),
      'xspace-agent/dist/tenant': path.join(mockDir, 'xspace-agent-tenant.ts'),
      'xspace-agent/dist/browser/selector-engine': path.join(mockDir, 'xspace-agent-selector-engine.ts'),
      'xspace-agent/dist/events': path.join(mockDir, 'xspace-agent-events.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/schemas/**',
        'src/index.ts',
        'src/**/types.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
    testTimeout: 10000,
  },
})


