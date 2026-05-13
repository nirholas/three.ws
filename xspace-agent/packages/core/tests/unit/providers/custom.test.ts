// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§82]

import { describe, it, expect } from 'vitest'

// The custom.ts file is just a type re-export, so we test that the types are properly exported
// and usable. This tests the type compatibility at the import level.

describe('Custom Provider (type re-export)', () => {
  it('should re-export CustomProvider type from pipeline/types', async () => {
    // Dynamic import to verify the module resolves correctly
    const customModule = await import('../../../src/providers/custom')
    // The module exports a type, so at runtime there's nothing concrete to check.
    // We verify the module resolves without error.
    expect(customModule).toBeDefined()
  })

  it('should have CustomProvider available from the main types', async () => {
    // Verify the canonical type is importable from the source
    const types = await import('../../../src/pipeline/types')
    expect(types).toBeDefined()
  })
})


