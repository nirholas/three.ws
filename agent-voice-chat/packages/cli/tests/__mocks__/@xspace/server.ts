// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§83]

// Stub module for @xspace/server so vitest can resolve the import.
// Tests override this with vi.mock().
export function createServer(_opts: any) {
  return {
    start: async () => {},
    stop: async () => {},
  }
}


